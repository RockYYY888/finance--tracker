"""add realtime analytics snapshot tables

Revision ID: 20260326_01
Revises: 20260325_01
Create Date: 2026-03-26 10:40:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260326_01"
down_revision: Union[str, Sequence[str], None] = "20260325_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector: sa.Inspector) -> set[str]:
	return set(inspector.get_table_names())


def upgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = _table_names(inspector)

	if "realtimeportfoliosnapshot" not in table_names:
		op.create_table(
			"realtimeportfoliosnapshot",
			sa.Column("id", sa.Integer(), nullable=False),
			sa.Column("user_id", sa.String(length=32), nullable=False),
			sa.Column("total_value_cny", sa.Float(), nullable=False, server_default="0"),
			sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
			sa.PrimaryKeyConstraint("id"),
		)
		op.create_index(
			op.f("ix_realtimeportfoliosnapshot_user_id"),
			"realtimeportfoliosnapshot",
			["user_id"],
			unique=False,
		)
		op.create_index(
			op.f("ix_realtimeportfoliosnapshot_created_at"),
			"realtimeportfoliosnapshot",
			["created_at"],
			unique=False,
		)

	if "realtimeholdingperformancesnapshot" not in table_names:
		op.create_table(
			"realtimeholdingperformancesnapshot",
			sa.Column("id", sa.Integer(), nullable=False),
			sa.Column("user_id", sa.String(length=32), nullable=False),
			sa.Column("scope", sa.String(length=16), nullable=False, server_default="TOTAL"),
			sa.Column("symbol", sa.String(), nullable=True),
			sa.Column("name", sa.String(length=120), nullable=True),
			sa.Column("return_pct", sa.Float(), nullable=False, server_default="0"),
			sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
			sa.PrimaryKeyConstraint("id"),
		)
		op.create_index(
			op.f("ix_realtimeholdingperformancesnapshot_user_id"),
			"realtimeholdingperformancesnapshot",
			["user_id"],
			unique=False,
		)
		op.create_index(
			op.f("ix_realtimeholdingperformancesnapshot_scope"),
			"realtimeholdingperformancesnapshot",
			["scope"],
			unique=False,
		)
		op.create_index(
			op.f("ix_realtimeholdingperformancesnapshot_symbol"),
			"realtimeholdingperformancesnapshot",
			["symbol"],
			unique=False,
		)
		op.create_index(
			op.f("ix_realtimeholdingperformancesnapshot_created_at"),
			"realtimeholdingperformancesnapshot",
			["created_at"],
			unique=False,
		)


def downgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = _table_names(inspector)

	if "realtimeholdingperformancesnapshot" in table_names:
		op.drop_index(
			op.f("ix_realtimeholdingperformancesnapshot_created_at"),
			table_name="realtimeholdingperformancesnapshot",
		)
		op.drop_index(
			op.f("ix_realtimeholdingperformancesnapshot_symbol"),
			table_name="realtimeholdingperformancesnapshot",
		)
		op.drop_index(
			op.f("ix_realtimeholdingperformancesnapshot_scope"),
			table_name="realtimeholdingperformancesnapshot",
		)
		op.drop_index(
			op.f("ix_realtimeholdingperformancesnapshot_user_id"),
			table_name="realtimeholdingperformancesnapshot",
		)
		op.drop_table("realtimeholdingperformancesnapshot")

	if "realtimeportfoliosnapshot" in table_names:
		op.drop_index(
			op.f("ix_realtimeportfoliosnapshot_created_at"),
			table_name="realtimeportfoliosnapshot",
		)
		op.drop_index(
			op.f("ix_realtimeportfoliosnapshot_user_id"),
			table_name="realtimeportfoliosnapshot",
		)
		op.drop_table("realtimeportfoliosnapshot")
