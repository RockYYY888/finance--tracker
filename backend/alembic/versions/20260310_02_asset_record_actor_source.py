"""add actor source to asset mutation audit

Revision ID: 20260310_02
Revises: 20260310_01
Create Date: 2026-03-10 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260310_02"
down_revision: Union[str, Sequence[str], None] = "20260310_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	column_names = {
		column_info["name"]
		for column_info in inspector.get_columns("assetmutationaudit")
	}
	index_names = {
		index_info["name"]
		for index_info in inspector.get_indexes("assetmutationaudit")
	}

	if "actor_source" not in column_names:
		op.add_column(
			"assetmutationaudit",
			sa.Column("actor_source", sa.String(length=16), nullable=False, server_default="USER"),
		)

	if op.f("ix_assetmutationaudit_actor_source") not in index_names:
		op.create_index(
			op.f("ix_assetmutationaudit_actor_source"),
			"assetmutationaudit",
			["actor_source"],
			unique=False,
		)

	if "actor_source" in column_names:
		op.alter_column("assetmutationaudit", "actor_source", server_default=None)


def downgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	index_names = {
		index_info["name"]
		for index_info in inspector.get_indexes("assetmutationaudit")
	}
	column_names = {
		column_info["name"]
		for column_info in inspector.get_columns("assetmutationaudit")
	}

	if op.f("ix_assetmutationaudit_actor_source") in index_names:
		op.drop_index(op.f("ix_assetmutationaudit_actor_source"), table_name="assetmutationaudit")
	if "actor_source" in column_names:
		op.drop_column("assetmutationaudit", "actor_source")
