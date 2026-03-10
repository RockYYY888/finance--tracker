from __future__ import annotations

import json

from sqlalchemy import delete, text
from sqlmodel import Session, select

from app.database import engine
from app.models import (
	CASH_SETTLEMENT_DIRECTIONS,
	AssetMutationAudit,
	CashAccount,
    CashLedgerEntry,
	FixedAsset,
	HoldingPerformanceSnapshot,
    HoldingTransactionCashSettlement,
	LiabilityEntry,
	OtherAsset,
	PortfolioSnapshot,
    SecurityHolding,
    SecurityHoldingTransaction,
	UserFeedback,
    UserAccount,
)
from app.services import service_context
from app.services.common_service import (
	_capture_model_state,
	_coerce_utc_datetime,
	_normalize_currency,
	_normalize_symbol,
	_server_today_date,
	_touch_model,
)
from app.services.portfolio_service import (
	HOLDING_QUANTITY_EPSILON,
	_apply_buy_funding_handling,
	_apply_sell_proceeds_handling,
	_delete_holding_transactions_for_symbol,
	_get_cash_account_initial_ledger_entry,
	_get_holding_transaction_cash_settlement,
	_get_latest_holding_transaction_for_symbol,
	_list_holdings_for_symbol,
	_normalize_holding_transaction_side,
	_record_holding_transaction_cash_settlement,
	_reset_holding_transactions_from_snapshot,
	_sum_cash_account_ledger_balance,
	_sync_cash_account_balance_from_ledger,
	_sync_holding_projection_for_symbol,
	_to_holding_transaction_reads,
)

def _audit_legacy_user_ownership() -> None:
	with Session(engine) as session:
		for table_name in (
			CashAccount.__table__.name,
			SecurityHolding.__table__.name,
			FixedAsset.__table__.name,
			LiabilityEntry.__table__.name,
			OtherAsset.__table__.name,
			PortfolioSnapshot.__table__.name,
			HoldingPerformanceSnapshot.__table__.name,
		):
			legacy_row_count = int(
				session.exec(
					text(
						f"SELECT COUNT(*) FROM {table_name} "
						"WHERE user_id IS NULL OR TRIM(user_id) = ''",
					),
				).one()[0],
			)
			if legacy_row_count > 0:
				service_context.logger.warning(
					"%s contains %s rows without a user_id. "
					"Those rows remain inaccessible until they are reassigned explicitly.",
					table_name,
					legacy_row_count,
				)

def _load_table_columns(session: Session, table_name: str) -> set[str]:
	rows = session.exec(text(f"PRAGMA table_info({table_name})")).all()
	return {row[1] for row in rows}

def _ensure_legacy_schema() -> None:
	"""Add newly introduced columns when the local SQLite file predates them."""
	schema_changes = (
		(
			UserAccount.__table__.name,
			{
				"email": "TEXT",
				"email_digest": "TEXT",
			},
		),
		(
			UserFeedback.__table__.name,
			{
				"category": "TEXT NOT NULL DEFAULT 'USER_REQUEST'",
				"priority": "TEXT NOT NULL DEFAULT 'MEDIUM'",
				"source": "TEXT NOT NULL DEFAULT 'USER'",
				"status": "TEXT NOT NULL DEFAULT 'OPEN'",
				"reply_message": "TEXT",
				"replied_at": "TEXT",
				"replied_by": "TEXT",
				"reply_seen_at": "TEXT",
				"resolved_at": "TEXT",
				"closed_by": "TEXT",
				"assignee": "TEXT",
				"acknowledged_at": "TEXT",
				"acknowledged_by": "TEXT",
				"ack_deadline": "TEXT",
				"internal_note": "TEXT",
				"internal_note_updated_at": "TEXT",
				"internal_note_updated_by": "TEXT",
				"fingerprint": "TEXT",
				"dedupe_window_minutes": "INTEGER",
				"occurrence_count": "INTEGER NOT NULL DEFAULT 1",
				"last_seen_at": "TEXT",
			},
		),
		(
			CashAccount.__table__.name,
			{
				"user_id": "TEXT",
				"account_type": "TEXT NOT NULL DEFAULT 'OTHER'",
				"started_on": "TEXT",
				"note": "TEXT",
			},
		),
		(
			SecurityHolding.__table__.name,
			{
				"user_id": "TEXT",
				"cost_basis_price": "REAL",
				"market": "TEXT NOT NULL DEFAULT 'OTHER'",
				"broker": "TEXT",
				"started_on": "TEXT",
				"note": "TEXT",
			},
		),
		(
			FixedAsset.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			LiabilityEntry.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			OtherAsset.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			PortfolioSnapshot.__table__.name,
			{
				"user_id": "TEXT",
			},
		),
		(
			HoldingPerformanceSnapshot.__table__.name,
			{
				"user_id": "TEXT",
			},
		),
		(
			HoldingTransactionCashSettlement.__table__.name,
			{
				"flow_direction": "TEXT NOT NULL DEFAULT 'INFLOW'",
			},
		),
		(
			AssetMutationAudit.__table__.name,
			{
				"agent_task_id": "INTEGER",
			},
		),
	)

	with Session(engine) as session:
		has_changes = False
		for table_name, column_defs in schema_changes:
			existing_columns = _load_table_columns(session, table_name)
			if not existing_columns:
				continue

			for column_name, definition in column_defs.items():
				if column_name in existing_columns:
					continue

				session.exec(
					text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
				)
				has_changes = True

		if has_changes:
			session.commit()

def _migrate_legacy_holdings_to_transactions() -> None:
	"""Backfill transaction rows from legacy holding snapshots for historical continuity."""
	with Session(engine) as session:
		holdings = list(
			session.exec(
				select(SecurityHolding)
				.order_by(SecurityHolding.user_id, SecurityHolding.symbol, SecurityHolding.id),
			),
		)
		if not holdings:
			return

		has_changes = False
		for holding in holdings:
			transactions = list(
				session.exec(
					select(SecurityHoldingTransaction)
					.where(SecurityHoldingTransaction.user_id == holding.user_id)
					.where(SecurityHoldingTransaction.symbol == holding.symbol)
					.where(SecurityHoldingTransaction.market == holding.market),
				),
			)

			if transactions:
				for transaction in transactions:
					if transaction.side == "ADJUST":
						transaction.side = "BUY"
						_touch_model(transaction)
						session.add(transaction)
						has_changes = True

				earliest_traded_on = min(item.traded_on for item in transactions)
				if holding.started_on is None or earliest_traded_on < holding.started_on:
					holding.started_on = earliest_traded_on
					_touch_model(holding)
					session.add(holding)
					has_changes = True
				continue

			fallback_started_on = holding.started_on or _server_today_date(
				_coerce_utc_datetime(holding.created_at),
			)
			if holding.started_on is None:
				holding.started_on = fallback_started_on
				_touch_model(holding)
				session.add(holding)
				has_changes = True

			if holding.quantity <= HOLDING_QUANTITY_EPSILON:
				continue

			session.add(
				SecurityHoldingTransaction(
					user_id=holding.user_id,
					symbol=holding.symbol,
					name=holding.name,
					side="BUY",
					quantity=max(holding.quantity, 0.0),
					price=holding.cost_basis_price
					if holding.cost_basis_price and holding.cost_basis_price > 0
					else None,
					fallback_currency=_normalize_currency(holding.fallback_currency),
					market=holding.market,
					broker=holding.broker,
					traded_on=fallback_started_on,
					note=holding.note,
				),
			)
			has_changes = True

		if has_changes:
			session.commit()

def _extract_transaction_id_from_sell_proceeds_reason(reason: str | None) -> int | None:
	if not reason or "#" not in reason:
		return None
	prefix, _, raw_id = reason.partition("#")
	if prefix not in {"SELL_PROCEEDS", "AUTO_SELL_PROCEEDS"}:
		return None
	try:
		return int(raw_id)
	except ValueError:
		return None

def _backfill_holding_transaction_cash_settlements() -> None:
	with Session(engine) as session:
		existing_transaction_ids = set(
			session.exec(select(HoldingTransactionCashSettlement.holding_transaction_id)).all(),
		)
		audits = list(
			session.exec(
				select(AssetMutationAudit)
				.where(AssetMutationAudit.entity_type == "CASH_ACCOUNT")
				.where(
					text(
						"(reason LIKE 'SELL_PROCEEDS#%' OR reason LIKE 'AUTO_SELL_PROCEEDS#%')",
					),
				)
				.order_by(AssetMutationAudit.created_at.asc(), AssetMutationAudit.id.asc()),
			),
		)
		if not audits:
			return

		has_changes = False
		for audit in audits:
			transaction_id = _extract_transaction_id_from_sell_proceeds_reason(audit.reason)
			if transaction_id is None or transaction_id in existing_transaction_ids:
				continue

			transaction = session.get(SecurityHoldingTransaction, transaction_id)
			if transaction is None:
				continue

			try:
				before_state = json.loads(audit.before_state) if audit.before_state else None
				after_state = json.loads(audit.after_state) if audit.after_state else None
			except json.JSONDecodeError:
				continue
			if not isinstance(after_state, dict):
				continue

			after_balance = float(after_state.get("balance") or 0.0)
			before_balance = (
				float(before_state.get("balance") or 0.0)
				if isinstance(before_state, dict)
				else 0.0
			)
			settled_amount = (
				after_balance
				if (audit.reason or "").startswith("AUTO_SELL_PROCEEDS#")
				else round(after_balance - before_balance, 8)
			)
			if settled_amount <= HOLDING_QUANTITY_EPSILON:
				continue

			session.add(
				HoldingTransactionCashSettlement(
					user_id=transaction.user_id,
					holding_transaction_id=transaction_id,
					cash_account_id=audit.entity_id or 0,
					handling=(
						"CREATE_NEW_CASH"
						if (audit.reason or "").startswith("AUTO_SELL_PROCEEDS#")
						else "ADD_TO_EXISTING_CASH"
					),
					settled_amount=round(settled_amount, 8),
					settled_currency=_normalize_currency(
						str(after_state.get("currency") or transaction.fallback_currency),
					),
					source_amount=round(transaction.quantity * (transaction.price or 0.0), 8),
					source_currency=_normalize_currency(transaction.fallback_currency),
					auto_created_cash_account=(audit.reason or "").startswith("AUTO_SELL_PROCEEDS#"),
				),
			)
			existing_transaction_ids.add(transaction_id)
			has_changes = True

		if has_changes:
			session.commit()

def _backfill_cash_ledger_entries() -> None:
	with Session(engine) as session:
		has_changes = False
		settlements = list(session.exec(select(HoldingTransactionCashSettlement)))
		existing_ledger_keys = {
			(entry.holding_transaction_id, entry.entry_type)
			for entry in session.exec(select(CashLedgerEntry)).all()
			if entry.holding_transaction_id is not None
		}

		for settlement in settlements:
			transaction = session.get(SecurityHoldingTransaction, settlement.holding_transaction_id)
			if transaction is None:
				continue
			if settlement.flow_direction not in CASH_SETTLEMENT_DIRECTIONS:
				settlement.flow_direction = "INFLOW"
				session.add(settlement)
				has_changes = True

			entry_type = "BUY_FUNDING" if settlement.flow_direction == "OUTFLOW" else "SELL_PROCEEDS"
			entry_key = (transaction.id or 0, entry_type)
			if entry_key in existing_ledger_keys:
				continue

			session.add(
				CashLedgerEntry(
					user_id=settlement.user_id,
					cash_account_id=settlement.cash_account_id,
					entry_type=entry_type,
					amount=(
						-round(settlement.settled_amount, 8)
						if settlement.flow_direction == "OUTFLOW"
						else round(settlement.settled_amount, 8)
					),
					currency=_normalize_currency(settlement.settled_currency),
					happened_on=transaction.traded_on,
					note=transaction.note,
					holding_transaction_id=transaction.id,
				),
			)
			existing_ledger_keys.add(entry_key)
			has_changes = True

		accounts = list(session.exec(select(CashAccount)))
		for account in accounts:
			initial_entry = _get_cash_account_initial_ledger_entry(
				session,
				user_id=account.user_id,
				cash_account_id=account.id or 0,
			)
			if initial_entry is None:
				non_initial_total = _sum_cash_account_ledger_balance(
					session,
					user_id=account.user_id,
					cash_account_id=account.id or 0,
				)
				session.add(
					CashLedgerEntry(
						user_id=account.user_id,
						cash_account_id=account.id or 0,
						entry_type="INITIAL_BALANCE",
						amount=round(account.balance - non_initial_total, 8),
						currency=_normalize_currency(account.currency),
						happened_on=account.started_on
						or _coerce_utc_datetime(account.created_at).date(),
						note="账户初始余额",
					),
				)
				has_changes = True

		if not has_changes:
			return

		session.flush()
		for account in accounts:
			_sync_cash_account_balance_from_ledger(session, account=account)
		session.commit()

__all__ = ['_audit_legacy_user_ownership', '_load_table_columns', '_ensure_legacy_schema', '_migrate_legacy_holdings_to_transactions', '_extract_transaction_id_from_sell_proceeds_reason', '_backfill_holding_transaction_cash_settlements', '_backfill_cash_ledger_entries', 'engine']
