from __future__ import annotations

import asyncio

from app.models import (
    CashAccount,
    CashLedgerEntry,
    CashTransfer,
    FixedAsset,
    HoldingTransactionCashSettlement,
    LiabilityEntry,
    SecurityHolding,
    SecurityHoldingTransaction,
)
from app.schemas import (
    CashAccountRead,
    CashLedgerEntryRead,
    CashTransferRead,
    LiabilityEntryRead,
    SecurityHoldingRead,
    SecurityHoldingTransactionRead,
    ValuedCashAccount,
    ValuedFixedAsset,
    ValuedHolding,
    ValuedLiabilityEntry,
    ValuedOtherAsset,
)
from app.services import service_context
from app.services.common_service import _calculate_return_pct, _normalize_currency
from app.services.market_data import QuoteLookupError

async def _load_display_fx_rates() -> tuple[dict[str, float], float | None, float | None, list[str]]:
	"""Load top-level display FX rates and reuse them in dashboard valuation."""
	rates: dict[str, float] = {"CNY": 1.0}
	warnings: list[str] = []
	usd_cny_rate: float | None = None
	hkd_cny_rate: float | None = None

	for currency_code in ("USD", "HKD"):
		try:
			rate, rate_warnings = await service_context.market_data_client.fetch_fx_rate(
				currency_code,
				"CNY",
			)
		except (QuoteLookupError, ValueError) as exc:
			warnings.append(f"{currency_code}/CNY 汇率拉取失败: {exc}")
			continue

		rates[currency_code] = rate
		warnings.extend(rate_warnings)
		if currency_code == "USD":
			usd_cny_rate = round(rate, 6)
		else:
			hkd_cny_rate = round(rate, 6)

	return rates, usd_cny_rate, hkd_cny_rate, warnings

async def _value_cash_accounts(
	accounts: list[CashAccount],
	fx_rate_overrides: dict[str, float] | None = None,
) -> tuple[list[ValuedCashAccount], float, list[str]]:
	items: list[ValuedCashAccount] = []
	total = 0.0
	warnings: list[str] = []

	for account in accounts:
		currency_code = _normalize_currency(account.currency)
		try:
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await service_context.market_data_client.fetch_fx_rate(
					currency_code,
					"CNY",
				)
			value_cny = round(account.balance * fx_rate, 2)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			fx_rate = 0.0
			value_cny = 0.0
			warnings.append(f"现金账户 {account.name} 换汇失败: {exc}")

		items.append(
			ValuedCashAccount(
				id=account.id or 0,
				name=account.name,
				platform=account.platform,
				balance=round(account.balance, 2),
				currency=account.currency,
				account_type=account.account_type,
				started_on=account.started_on,
				note=account.note,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings

async def _value_holdings(
	holdings: list[SecurityHolding],
	fx_rate_overrides: dict[str, float] | None = None,
	*,
	force_pending: bool = False,
) -> tuple[list[ValuedHolding], float, list[str]]:
	items: list[ValuedHolding] = []
	total = 0.0
	warnings: list[str] = []

	for holding in holdings:
		try:
			quote, quote_warnings = await service_context.market_data_client.fetch_quote(
				holding.symbol,
				holding.market,
			)
			currency_code = _normalize_currency(quote.currency)
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await service_context.market_data_client.fetch_fx_rate(
					currency_code,
					"CNY",
				)
			value_cny = round(holding.quantity * quote.price * fx_rate, 2)
			price = round(quote.price, 4)
			price_currency = currency_code
			last_updated = quote.market_time
			warnings.extend(quote_warnings)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			service_context.logger.warning(
				"Quote lookup still pending for %s: %s",
				holding.symbol,
				exc,
			)
			value_cny = 0.0
			price = 0.0
			price_currency = holding.fallback_currency
			fx_rate = 0.0
			last_updated = None
			warnings.append(f"持仓 {holding.symbol} 行情更新中")

		items.append(
			ValuedHolding(
				id=holding.id or 0,
				symbol=holding.symbol,
				name=holding.name,
				quantity=round(holding.quantity, 4),
				fallback_currency=holding.fallback_currency,
				cost_basis_price=round(holding.cost_basis_price, 4)
				if holding.cost_basis_price is not None
				else None,
				market=holding.market,
				broker=holding.broker,
				started_on=holding.started_on,
				note=holding.note,
				price=price,
				price_currency=price_currency,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
				return_pct=_calculate_return_pct(price, holding.cost_basis_price)
				if price > 0
				else None,
				last_updated=None if force_pending else last_updated,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings

def _value_fixed_assets(
	assets: list[FixedAsset],
) -> tuple[list[ValuedFixedAsset], float]:
	items: list[ValuedFixedAsset] = []
	total = 0.0

	for asset in assets:
		value_cny = round(asset.current_value_cny, 2)
		items.append(
			ValuedFixedAsset(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=value_cny,
				purchase_value_cny=round(asset.purchase_value_cny, 2)
				if asset.purchase_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=value_cny,
				return_pct=_calculate_return_pct(value_cny, asset.purchase_value_cny),
			),
		)
		total += value_cny

	return items, round(total, 2)

async def _value_liabilities(
	entries: list[LiabilityEntry],
	fx_rate_overrides: dict[str, float] | None = None,
) -> tuple[list[ValuedLiabilityEntry], float, list[str]]:
	items: list[ValuedLiabilityEntry] = []
	total = 0.0
	warnings: list[str] = []

	for entry in entries:
		currency_code = _normalize_currency(entry.currency)
		try:
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await service_context.market_data_client.fetch_fx_rate(
					currency_code,
					"CNY",
				)
			value_cny = round(entry.balance * fx_rate, 2)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			fx_rate = 0.0
			value_cny = 0.0
			warnings.append(f"负债 {entry.name} 换汇失败: {exc}")

		items.append(
			ValuedLiabilityEntry(
				id=entry.id or 0,
				name=entry.name,
				category=entry.category,
				currency=entry.currency,
				balance=round(entry.balance, 2),
				started_on=entry.started_on,
				note=entry.note,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings

def _value_other_assets(
	assets: list[OtherAsset],
) -> tuple[list[ValuedOtherAsset], float]:
	items: list[ValuedOtherAsset] = []
	total = 0.0

	for asset in assets:
		value_cny = round(asset.current_value_cny, 2)
		items.append(
			ValuedOtherAsset(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=value_cny,
				original_value_cny=round(asset.original_value_cny, 2)
				if asset.original_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=value_cny,
				return_pct=_calculate_return_pct(value_cny, asset.original_value_cny),
			),
		)
		total += value_cny

	return items, round(total, 2)

def _to_cash_account_read(account: CashAccount) -> CashAccountRead:
	valued_accounts, _, _warnings = asyncio.run(_value_cash_accounts([account]))
	valued_account = valued_accounts[0] if valued_accounts else None
	return CashAccountRead(
		id=account.id or 0,
		name=account.name,
		platform=account.platform,
		currency=account.currency,
		balance=account.balance,
		account_type=account.account_type,
		started_on=account.started_on,
		note=account.note,
		fx_to_cny=valued_account.fx_to_cny if valued_account else None,
		value_cny=valued_account.value_cny if valued_account else None,
	)

def _to_cash_ledger_entry_read(entry: CashLedgerEntry) -> CashLedgerEntryRead:
	return CashLedgerEntryRead(
		id=entry.id or 0,
		cash_account_id=entry.cash_account_id,
		entry_type=entry.entry_type,
		amount=entry.amount,
		currency=entry.currency,
		happened_on=entry.happened_on,
		note=entry.note,
		holding_transaction_id=entry.holding_transaction_id,
		cash_transfer_id=entry.cash_transfer_id,
		created_at=entry.created_at,
		updated_at=entry.updated_at,
	)

def _to_cash_transfer_read(transfer: CashTransfer) -> CashTransferRead:
	return CashTransferRead(
		id=transfer.id or 0,
		from_account_id=transfer.from_account_id,
		to_account_id=transfer.to_account_id,
		source_amount=transfer.source_amount,
		target_amount=transfer.target_amount,
		source_currency=transfer.source_currency,
		target_currency=transfer.target_currency,
		transferred_on=transfer.transferred_on,
		note=transfer.note,
		created_at=transfer.created_at,
		updated_at=transfer.updated_at,
	)

def _to_holding_read(holding: SecurityHolding) -> SecurityHoldingRead:
	valued_holdings, _, _warnings = asyncio.run(_value_holdings([holding]))
	valued_holding = valued_holdings[0] if valued_holdings else None
	return SecurityHoldingRead(
		id=holding.id or 0,
		symbol=holding.symbol,
		name=holding.name,
		quantity=holding.quantity,
		fallback_currency=holding.fallback_currency,
		cost_basis_price=holding.cost_basis_price,
		market=holding.market,
		broker=holding.broker,
		started_on=holding.started_on,
		note=holding.note,
		price=valued_holding.price if valued_holding else None,
		price_currency=valued_holding.price_currency if valued_holding else None,
		value_cny=valued_holding.value_cny if valued_holding else None,
		return_pct=valued_holding.return_pct if valued_holding else None,
		last_updated=valued_holding.last_updated if valued_holding else None,
	)

def _to_holding_transaction_read(
	transaction: SecurityHoldingTransaction,
	settlement: HoldingTransactionCashSettlement | None = None,
) -> SecurityHoldingTransactionRead:
	sell_proceeds_handling: str | None = None
	sell_proceeds_account_id: int | None = None
	buy_funding_handling: str | None = None
	buy_funding_account_id: int | None = None
	if settlement is not None:
		if settlement.flow_direction == "INFLOW":
			sell_proceeds_handling = settlement.handling
			sell_proceeds_account_id = settlement.cash_account_id
		elif settlement.flow_direction == "OUTFLOW":
			buy_funding_handling = settlement.handling
			buy_funding_account_id = settlement.cash_account_id

	return SecurityHoldingTransactionRead(
		id=transaction.id or 0,
		symbol=transaction.symbol,
		name=transaction.name,
		side=transaction.side,
		quantity=transaction.quantity,
		price=transaction.price,
		fallback_currency=transaction.fallback_currency,
		market=transaction.market,
		broker=transaction.broker,
		traded_on=transaction.traded_on,
		note=transaction.note,
		sell_proceeds_handling=sell_proceeds_handling,
		sell_proceeds_account_id=sell_proceeds_account_id,
		buy_funding_handling=buy_funding_handling,
		buy_funding_account_id=buy_funding_account_id,
		created_at=transaction.created_at,
		updated_at=transaction.updated_at,
	)

def _to_liability_read(entry: LiabilityEntry) -> LiabilityEntryRead:
	valued_entries, _, _warnings = asyncio.run(_value_liabilities([entry]))
	valued_entry = valued_entries[0] if valued_entries else None
	return LiabilityEntryRead(
		id=entry.id or 0,
		name=entry.name,
		category=entry.category,
		currency=entry.currency,
		balance=round(entry.balance, 2),
		started_on=entry.started_on,
		note=entry.note,
		fx_to_cny=valued_entry.fx_to_cny if valued_entry else None,
		value_cny=valued_entry.value_cny if valued_entry else None,
	)

__all__ = ['_load_display_fx_rates', '_value_cash_accounts', '_value_holdings', '_value_fixed_assets', '_value_liabilities', '_value_other_assets', '_to_cash_account_read', '_to_cash_ledger_entry_read', '_to_cash_transfer_read', '_to_holding_read', '_to_holding_transaction_read', '_to_liability_read']
