from __future__ import annotations

import json
from typing import Annotated

from fastapi import Header, HTTPException, Query
from sqlmodel import select

from app.models import (
	AGENT_REGISTRATION_STATUSES,
	AGENT_TASK_STATUSES,
	HOLDING_HISTORY_SYNC_STATUSES,
	AgentAccessToken,
	AgentRegistration,
	AgentTask,
	HoldingHistorySyncRequest,
	utc_now,
)
from app.schemas import AgentContextRead, AgentRegistrationRead, AgentTaskCreate, AgentTaskRead
from app.services import job_service
from app.services.auth_service import (
	CurrentUserDependency,
	_is_agent_token_active,
	create_agent_token_for_current_session,
	issue_agent_token_with_password,
	list_agent_tokens,
	revoke_agent_token,
)
from app.services.common_service import (
    _build_idempotency_request_hash,
    _load_idempotent_response,
    _store_idempotent_response,
)
from app.services.portfolio_service import _list_holding_transactions_for_user, _to_holding_transaction_reads
from app.services.service_context import SessionDependency

def _to_agent_task_read(task: AgentTask) -> AgentTaskRead:
	return AgentTaskRead(
		id=task.id or 0,
		task_type=task.task_type,
		status=task.status,
		payload=json.loads(task.input_json),
		result=json.loads(task.result_json) if task.result_json else None,
		error_message=task.error_message,
		created_at=task.created_at,
		updated_at=task.updated_at,
		completed_at=task.completed_at,
	)


def _to_agent_registration_read(
	registration: AgentRegistration,
	*,
	tokens: list[AgentAccessToken],
) -> AgentRegistrationRead:
	now = utc_now()
	sorted_tokens = sorted(
		tokens,
		key=lambda token: (token.created_at, token.id or 0),
		reverse=True,
	)
	active_token_count = sum(1 for token in tokens if _is_agent_token_active(token, now))
	last_used_at = max(
		(
			token.last_used_at
			for token in tokens
			if token.last_used_at is not None
		),
		default=None,
	)
	return AgentRegistrationRead(
		id=registration.id or 0,
		user_id=registration.user_id,
		name=registration.name,
		status=(
			AGENT_REGISTRATION_STATUSES[0]
			if active_token_count > 0
			else AGENT_REGISTRATION_STATUSES[1]
		),
		active_token_count=active_token_count,
		total_token_count=len(tokens),
		latest_token_hint=sorted_tokens[0].token_hint if sorted_tokens else None,
		last_used_at=last_used_at,
		last_seen_at=registration.last_seen_at,
		created_at=registration.created_at,
		updated_at=registration.updated_at,
	)

async def get_agent_context(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	refresh: bool = False,
	transaction_limit: int = Query(default=50, ge=1, le=500),
) -> AgentContextRead:
	from app.services.dashboard_service import get_dashboard

	dashboard = await get_dashboard(current_user, session, refresh)
	recent_transactions = _list_holding_transactions_for_user(
		session,
		user_id=current_user.username,
		limit=transaction_limit,
	)
	pending_history_sync_requests = len(
		list(
			session.exec(
				select(HoldingHistorySyncRequest.id).where(
					HoldingHistorySyncRequest.user_id == current_user.username,
					HoldingHistorySyncRequest.status != HOLDING_HISTORY_SYNC_STATUSES[2],
				),
			),
		),
	)
	return AgentContextRead(
		user_id=current_user.username,
		generated_at=utc_now(),
		server_today=dashboard.server_today,
		total_value_cny=dashboard.total_value_cny,
		cash_value_cny=dashboard.cash_value_cny,
		holdings_value_cny=dashboard.holdings_value_cny,
		fixed_assets_value_cny=dashboard.fixed_assets_value_cny,
		liabilities_value_cny=dashboard.liabilities_value_cny,
		other_assets_value_cny=dashboard.other_assets_value_cny,
		usd_cny_rate=dashboard.usd_cny_rate,
		hkd_cny_rate=dashboard.hkd_cny_rate,
		allocation=dashboard.allocation,
		cash_accounts=dashboard.cash_accounts,
		holdings=dashboard.holdings,
		recent_holding_transactions=_to_holding_transaction_reads(
			session,
			user_id=current_user.username,
			transactions=recent_transactions,
		),
		pending_history_sync_requests=pending_history_sync_requests,
		warnings=dashboard.warnings,
	)

def list_agent_tasks(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	limit: int = Query(default=50, ge=1, le=200),
) -> list[AgentTaskRead]:
	tasks = list(
		session.exec(
			select(AgentTask)
			.where(AgentTask.user_id == current_user.username)
			.order_by(AgentTask.created_at.desc(), AgentTask.id.desc())
			.limit(limit),
		),
	)
	return [_to_agent_task_read(task) for task in tasks]


def list_agent_registrations(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	include_all_users: bool = Query(default=False),
) -> list[AgentRegistrationRead]:
	if include_all_users and current_user.username != "admin":
		raise HTTPException(status_code=403, detail="仅管理员可查看所有账号的 Agent 接入。")

	statement = select(AgentRegistration)
	if not include_all_users:
		statement = statement.where(AgentRegistration.user_id == current_user.username)

	registrations = list(
		session.exec(
			statement.order_by(
				AgentRegistration.updated_at.desc(),
				AgentRegistration.id.desc(),
			),
		),
	)
	if not registrations:
		return []

	registration_ids = [registration.id for registration in registrations if registration.id is not None]
	tokens = list(
		session.exec(
			select(AgentAccessToken)
			.where(AgentAccessToken.agent_registration_id.in_(registration_ids)),
		),
	) if registration_ids else []
	tokens_by_registration_id: dict[int, list[AgentAccessToken]] = {}
	for token in tokens:
		if token.agent_registration_id is None:
			continue
		tokens_by_registration_id.setdefault(token.agent_registration_id, []).append(token)

	return [
		_to_agent_registration_read(
			registration,
			tokens=tokens_by_registration_id.get(registration.id or 0, []),
		)
		for registration in registrations
	]

def create_agent_task(
	payload: AgentTaskCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> AgentTaskRead:
	request_hash = _build_idempotency_request_hash(payload)
	idempotent_response = _load_idempotent_response(
		session,
		user_id=current_user.username,
		scope="agent_task.create",
		idempotency_key=idempotency_key,
		request_hash=request_hash,
		response_model=AgentTaskRead,
	)
	if idempotent_response is not None:
		existing_task = session.get(AgentTask, idempotent_response.id)
		return _to_agent_task_read(existing_task) if existing_task is not None else idempotent_response

	task = AgentTask(
		user_id=current_user.username,
		task_type=payload.task_type,
		status=AGENT_TASK_STATUSES[0],
		input_json=json.dumps(payload.payload, sort_keys=True, ensure_ascii=False),
	)
	session.add(task)
	session.flush()
	job_service.enqueue_agent_task_execution(
		session,
		user_id=current_user.username,
		agent_task_id=task.id or 0,
	)
	response = _to_agent_task_read(task)
	_store_idempotent_response(
		session,
		user_id=current_user.username,
		scope="agent_task.create",
		idempotency_key=idempotency_key,
		request_hash=request_hash,
		response=response,
	)
	session.commit()
	session.refresh(task)
	return _to_agent_task_read(task)

__all__ = [
	'_to_agent_task_read',
	'_to_agent_registration_read',
	'create_agent_task',
	'create_agent_token_for_current_session',
	'get_agent_context',
	'issue_agent_token_with_password',
	'list_agent_registrations',
	'list_agent_tasks',
	'list_agent_tokens',
	'revoke_agent_token',
]
