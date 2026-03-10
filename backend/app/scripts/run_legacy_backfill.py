from app.database import init_db
from app.services import legacy_service


def main() -> None:
	init_db()
	legacy_service._ensure_legacy_schema()
	legacy_service._migrate_legacy_holdings_to_transactions()
	legacy_service._backfill_holding_transaction_cash_settlements()
	legacy_service._backfill_cash_ledger_entries()
	legacy_service._audit_legacy_user_ownership()
	print("legacy backfill completed")


if __name__ == "__main__":
	main()
