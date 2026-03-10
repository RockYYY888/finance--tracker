"""add agent registrations and link tokens

Revision ID: 20260311_03
Revises: 20260310_02
Create Date: 2026-03-11 01:15:00.000000

"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260311_03"
down_revision: Union[str, Sequence[str], None] = "20260310_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _utc_now_naive() -> datetime:
	return datetime.now(timezone.utc).replace(tzinfo=None)


def upgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = set(inspector.get_table_names())

	if "agentregistration" not in table_names:
		op.create_table(
			"agentregistration",
			sa.Column("id", sa.Integer(), nullable=False),
			sa.Column("user_id", sa.String(length=32), nullable=False),
			sa.Column("name", sa.String(length=80), nullable=False),
			sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
			sa.Column("created_at", sa.DateTime(), nullable=False),
			sa.Column("updated_at", sa.DateTime(), nullable=False),
			sa.Column("last_seen_at", sa.DateTime(), nullable=True),
			sa.PrimaryKeyConstraint("id"),
			sa.UniqueConstraint("user_id", "name", name="uq_agent_registration_user_name"),
		)
		op.create_index("ix_agentregistration_user_id", "agentregistration", ["user_id"], unique=False)
		op.create_index("ix_agentregistration_status", "agentregistration", ["status"], unique=False)
		op.create_index("ix_agentregistration_created_at", "agentregistration", ["created_at"], unique=False)
		op.create_index("ix_agentregistration_updated_at", "agentregistration", ["updated_at"], unique=False)
		op.create_index("ix_agentregistration_last_seen_at", "agentregistration", ["last_seen_at"], unique=False)

	agent_token_columns = {
		column_info["name"]
		for column_info in inspector.get_columns("agentaccesstoken")
	}
	agent_token_indexes = {
		index_info["name"]
		for index_info in inspector.get_indexes("agentaccesstoken")
	}
	if "agent_registration_id" not in agent_token_columns:
		op.add_column(
			"agentaccesstoken",
			sa.Column("agent_registration_id", sa.Integer(), nullable=True),
		)
	if "ix_agentaccesstoken_agent_registration_id" not in agent_token_indexes:
		op.create_index(
			"ix_agentaccesstoken_agent_registration_id",
			"agentaccesstoken",
			["agent_registration_id"],
			unique=False,
		)

	agent_registration = sa.table(
		"agentregistration",
		sa.column("id", sa.Integer()),
		sa.column("user_id", sa.String()),
		sa.column("name", sa.String()),
		sa.column("status", sa.String()),
		sa.column("created_at", sa.DateTime()),
		sa.column("updated_at", sa.DateTime()),
		sa.column("last_seen_at", sa.DateTime()),
	)
	agent_token = sa.table(
		"agentaccesstoken",
		sa.column("id", sa.Integer()),
		sa.column("user_id", sa.String()),
		sa.column("agent_registration_id", sa.Integer()),
		sa.column("name", sa.String()),
		sa.column("token_hint", sa.String()),
		sa.column("created_at", sa.DateTime()),
		sa.column("updated_at", sa.DateTime()),
		sa.column("last_used_at", sa.DateTime()),
		sa.column("expires_at", sa.DateTime()),
		sa.column("revoked_at", sa.DateTime()),
	)

	now = _utc_now_naive()
	token_groups = bind.execute(
		sa.select(agent_token.c.user_id, agent_token.c.name)
		.where(agent_token.c.agent_registration_id.is_(None))
		.distinct(),
	).all()
	for user_id, raw_name in token_groups:
		name = (raw_name or "").strip()
		if not user_id or not name:
			continue

		existing_registration_id = bind.execute(
			sa.select(agent_registration.c.id)
			.where(agent_registration.c.user_id == user_id)
			.where(agent_registration.c.name == name)
			.limit(1),
		).scalar_one_or_none()

		token_rows = bind.execute(
			sa.select(
				agent_token.c.id,
				agent_token.c.created_at,
				agent_token.c.updated_at,
				agent_token.c.last_used_at,
				agent_token.c.expires_at,
				agent_token.c.revoked_at,
			)
			.where(agent_token.c.user_id == user_id)
			.where(agent_token.c.name == name),
		).all()
		active_token_exists = any(
			token_row.revoked_at is None
			and (token_row.expires_at is None or token_row.expires_at > now)
			for token_row in token_rows
		)
		last_seen_at = max(
			(
				token_row.last_used_at
				for token_row in token_rows
				if token_row.last_used_at is not None
			),
			default=None,
		)
		created_at = min(
			(
				token_row.created_at
				for token_row in token_rows
				if token_row.created_at is not None
			),
			default=now,
		)
		updated_at = max(
			(
				token_row.updated_at
				for token_row in token_rows
				if token_row.updated_at is not None
			),
			default=now,
		)

		if existing_registration_id is None:
			inserted = bind.execute(
				agent_registration.insert().values(
					user_id=user_id,
					name=name,
					status="ACTIVE" if active_token_exists else "INACTIVE",
					created_at=created_at,
					updated_at=updated_at,
					last_seen_at=last_seen_at,
				),
			)
			registration_id = inserted.inserted_primary_key[0]
		else:
			registration_id = existing_registration_id
			bind.execute(
				agent_registration.update()
				.where(agent_registration.c.id == registration_id)
				.values(
					status="ACTIVE" if active_token_exists else "INACTIVE",
					updated_at=updated_at,
					last_seen_at=last_seen_at,
				),
			)

		bind.execute(
			agent_token.update()
			.where(agent_token.c.user_id == user_id)
			.where(agent_token.c.name == name)
			.where(agent_token.c.agent_registration_id.is_(None))
			.values(agent_registration_id=registration_id),
		)


def downgrade() -> None:
	bind = op.get_bind()
	inspector = sa.inspect(bind)
	table_names = set(inspector.get_table_names())

	if "agentaccesstoken" in table_names:
		agent_token_columns = {
			column_info["name"]
			for column_info in inspector.get_columns("agentaccesstoken")
		}
		agent_token_indexes = {
			index_info["name"]
			for index_info in inspector.get_indexes("agentaccesstoken")
		}
		if "ix_agentaccesstoken_agent_registration_id" in agent_token_indexes:
			op.drop_index("ix_agentaccesstoken_agent_registration_id", table_name="agentaccesstoken")
		if "agent_registration_id" in agent_token_columns:
			op.drop_column("agentaccesstoken", "agent_registration_id")

	if "agentregistration" in table_names:
		index_names = {
			index_info["name"]
			for index_info in inspector.get_indexes("agentregistration")
		}
		for index_name in (
			"ix_agentregistration_user_id",
			"ix_agentregistration_status",
			"ix_agentregistration_created_at",
			"ix_agentregistration_updated_at",
			"ix_agentregistration_last_seen_at",
		):
			if index_name in index_names:
				op.drop_index(index_name, table_name="agentregistration")
		op.drop_table("agentregistration")
