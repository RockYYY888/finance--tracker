from app.database import init_db
from app.services import core_support


def main() -> None:
	init_db()
	core_support._ensure_legacy_schema()
	core_support._migrate_legacy_holdings_to_transactions()
	core_support._backfill_holding_transaction_cash_settlements()
	core_support._backfill_cash_ledger_entries()
	core_support._audit_legacy_user_ownership()
	print("legacy backfill completed")


if __name__ == "__main__":
	main()
