"""migrate financial columns from float to fixed-precision numeric

Revision ID: 20260327_01
Revises: 20260326_01
Create Date: 2026-03-27 13:20:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260327_01"
down_revision: Union[str, Sequence[str], None] = "20260326_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NUMERIC_TYPE = sa.Numeric(precision=24, scale=8, asdecimal=True)
FLOAT_TYPE = sa.Float()

TABLE_COLUMN_MAP: dict[str, tuple[str, ...]] = {
	"cashaccount": ("balance",),
	"securityholding": ("quantity", "cost_basis_price"),
	"securityholdingtransaction": ("quantity", "price"),
	"holdingtransactioncashsettlement": ("settled_amount", "source_amount"),
	"cashledgerentry": ("amount",),
	"cashtransfer": ("source_amount", "target_amount"),
	"fixedasset": ("current_value_cny", "purchase_value_cny"),
	"liabilityentry": ("balance",),
	"otherasset": ("current_value_cny", "original_value_cny"),
	"portfoliosnapshot": ("total_value_cny",),
	"holdingperformancesnapshot": ("return_pct",),
	"realtimeportfoliosnapshot": ("total_value_cny",),
	"realtimeholdingperformancesnapshot": ("return_pct",),
	"dashboardcorrection": ("corrected_value",),
}


def _existing_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
	return {column["name"] for column in inspector.get_columns(table_name)}


def _alter_numeric_columns(*, to_type: sa.TypeEngine, postgres_using_template: str) -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = set(inspector.get_table_names())

	for table_name, column_names in TABLE_COLUMN_MAP.items():
		if table_name not in table_names:
			continue
		existing_columns = _existing_columns(inspector, table_name)
		for column_name in column_names:
			if column_name not in existing_columns:
				continue
			op.alter_column(
				table_name,
				column_name,
				type_=to_type,
				postgresql_using=postgres_using_template.format(column=column_name),
			)


def upgrade() -> None:
	_alter_numeric_columns(
		to_type=NUMERIC_TYPE,
		postgres_using_template="{column}::numeric(24, 8)",
	)


def downgrade() -> None:
	_alter_numeric_columns(
		to_type=FLOAT_TYPE,
		postgres_using_template="{column}::double precision",
	)
