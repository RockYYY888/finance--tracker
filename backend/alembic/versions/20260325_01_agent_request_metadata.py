"""add agent request metadata and API key counters

Revision ID: 20260325_01
Revises: 20260311_03
Create Date: 2026-03-25 10:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260325_01"
down_revision: Union[str, Sequence[str], None] = "20260311_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
	return {column_info["name"] for column_info in inspector.get_columns(table_name)}


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
	return {index_info["name"] for index_info in inspector.get_indexes(table_name)}


def upgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = set(inspector.get_table_names())

	if "agentregistration" in table_names:
		columns = _column_names(inspector, "agentregistration")
		if "request_count" not in columns:
			op.add_column(
				"agentregistration",
				sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
			)
		if "latest_api_key_name" not in columns:
			op.add_column(
				"agentregistration",
				sa.Column("latest_api_key_name", sa.String(length=80), nullable=True),
			)
		bind.execute(sa.text("UPDATE agentregistration SET request_count = 1 WHERE request_count = 0"))
		bind.execute(
			sa.text(
				"UPDATE agentregistration "
				"SET latest_api_key_name = name "
				"WHERE latest_api_key_name IS NULL",
			),
		)

	if "agenttask" in table_names:
		columns = _column_names(inspector, "agenttask")
		indexes = _index_names(inspector, "agenttask")
		if "request_source" not in columns:
			op.add_column(
				"agenttask",
				sa.Column("request_source", sa.String(length=16), nullable=False, server_default="AGENT"),
			)
		if "api_key_name" not in columns:
			op.add_column(
				"agenttask",
				sa.Column("api_key_name", sa.String(length=80), nullable=True),
			)
		if "agent_name" not in columns:
			op.add_column(
				"agenttask",
				sa.Column("agent_name", sa.String(length=80), nullable=True),
			)
		if "ix_agenttask_request_source" not in indexes:
			op.create_index("ix_agenttask_request_source", "agenttask", ["request_source"], unique=False)

	if "assetmutationaudit" in table_names:
		columns = _column_names(inspector, "assetmutationaudit")
		if "api_key_name" not in columns:
			op.add_column(
				"assetmutationaudit",
				sa.Column("api_key_name", sa.String(length=80), nullable=True),
			)
		if "agent_name" not in columns:
			op.add_column(
				"assetmutationaudit",
				sa.Column("agent_name", sa.String(length=80), nullable=True),
			)


def downgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = set(inspector.get_table_names())

	if "assetmutationaudit" in table_names:
		columns = _column_names(inspector, "assetmutationaudit")
		if "agent_name" in columns:
			op.drop_column("assetmutationaudit", "agent_name")
		if "api_key_name" in columns:
			op.drop_column("assetmutationaudit", "api_key_name")

	if "agenttask" in table_names:
		columns = _column_names(inspector, "agenttask")
		indexes = _index_names(inspector, "agenttask")
		if "ix_agenttask_request_source" in indexes:
			op.drop_index("ix_agenttask_request_source", table_name="agenttask")
		if "agent_name" in columns:
			op.drop_column("agenttask", "agent_name")
		if "api_key_name" in columns:
			op.drop_column("agenttask", "api_key_name")
		if "request_source" in columns:
			op.drop_column("agenttask", "request_source")

	if "agentregistration" in table_names:
		columns = _column_names(inspector, "agentregistration")
		if "latest_api_key_name" in columns:
			op.drop_column("agentregistration", "latest_api_key_name")
		if "request_count" in columns:
			op.drop_column("agentregistration", "request_count")
