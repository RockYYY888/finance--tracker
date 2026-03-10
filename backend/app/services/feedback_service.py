from __future__ import annotations

from datetime import timedelta, timezone

from fastapi import HTTPException, Query
from sqlmodel import select

from app.models import (
	FEEDBACK_CATEGORIES,
	FEEDBACK_PRIORITIES,
	FEEDBACK_SOURCES,
	FEEDBACK_STATUSES,
	InboxMessageVisibility,
	ReleaseNoteDelivery,
	UserFeedback,
	utc_now,
)
from app.schemas import (
    ActionMessageRead,
    AdminFeedbackAcknowledgeUpdate,
    AdminFeedbackClassifyUpdate,
    AdminFeedbackListRead,
    AdminFeedbackRead,
    AdminFeedbackReplyUpdate,
    FeedbackSummaryRead,
    InboxMessageHideCreate,
    UserFeedbackCreate,
    UserFeedbackRead,
)
from app.services.auth_service import CurrentUserDependency, TokenDependency
from app.services.common_service import (
    FEEDBACK_TIMEZONE,
    MAX_DAILY_FEEDBACK_SUBMISSIONS,
    _feedback_day_window,
    _require_admin_user,
)
from app.services.inbox_service import _load_hidden_message_ids
from app.services.release_note_service import _ensure_release_note_deliveries_for_user
from app.services.service_context import SessionDependency

def _normalize_feedback_choice(
	value: str | None,
	allowed_values: tuple[str, ...],
	fallback: str,
) -> str:
	if value is None:
		return fallback

	normalized = value.strip().upper()
	if normalized in allowed_values:
		return normalized
	return fallback

def _is_system_feedback_item(feedback: UserFeedback) -> bool:
	category = _normalize_feedback_choice(
		feedback.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	)
	source = _normalize_feedback_choice(
		feedback.source,
		FEEDBACK_SOURCES,
		"USER",
	)
	return category.startswith("SYSTEM_") or source != "USER"

def _is_user_feedback_item(feedback: UserFeedback) -> bool:
	return not _is_system_feedback_item(feedback)

def _derive_feedback_status(feedback: UserFeedback) -> str:
	if feedback.resolved_at is not None:
		return "RESOLVED"

	status = _normalize_feedback_choice(
		feedback.status,
		FEEDBACK_STATUSES,
		"OPEN",
	)
	if status == "RESOLVED":
		return "OPEN"
	if status == "ACKED":
		return "ACKED"
	if status == "IN_PROGRESS":
		return "IN_PROGRESS"
	if status == "SILENCED":
		return "SILENCED"
	if feedback.replied_at is not None:
		return "IN_PROGRESS"
	return "OPEN"

def _feedback_sort_key(feedback: UserFeedback) -> tuple[int, int, float]:
	status_rank = {
		"OPEN": 0,
		"ACKED": 1,
		"IN_PROGRESS": 2,
		"SILENCED": 3,
		"RESOLVED": 4,
	}
	priority_rank = {
		"HIGH": 0,
		"MEDIUM": 1,
		"LOW": 2,
	}
	status_value = _derive_feedback_status(feedback)
	priority_value = _normalize_feedback_choice(
		feedback.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	)
	created_at = feedback.created_at
	if created_at.tzinfo is None:
		created_at = created_at.replace(tzinfo=timezone.utc)
	return (
		status_rank.get(status_value, 3),
		priority_rank.get(priority_value, 3),
		-created_at.timestamp(),
	)

def _to_feedback_read(feedback: UserFeedback) -> UserFeedbackRead:
	category = _normalize_feedback_choice(
		feedback.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	)
	priority = _normalize_feedback_choice(
		feedback.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	)
	source = _normalize_feedback_choice(
		feedback.source,
		FEEDBACK_SOURCES,
		"USER",
	)
	status = _derive_feedback_status(feedback)
	return UserFeedbackRead(
		id=feedback.id or 0,
		user_id=feedback.user_id,
		message=feedback.message,
		category=category,
		priority=priority,
		source=source,
		status=status,
		is_system=_is_system_feedback_item(feedback),
		reply_message=feedback.reply_message,
		replied_at=feedback.replied_at,
		replied_by=feedback.replied_by,
		reply_seen_at=feedback.reply_seen_at,
		resolved_at=feedback.resolved_at,
		closed_by=feedback.closed_by,
		created_at=feedback.created_at,
	)

def _to_admin_feedback_read(feedback: UserFeedback) -> AdminFeedbackRead:
	base_read = _to_feedback_read(feedback)
	return AdminFeedbackRead(
		**base_read.model_dump(),
		assignee=feedback.assignee,
		acknowledged_at=feedback.acknowledged_at,
		acknowledged_by=feedback.acknowledged_by,
		ack_deadline=feedback.ack_deadline,
		internal_note=feedback.internal_note,
		internal_note_updated_at=feedback.internal_note_updated_at,
		internal_note_updated_by=feedback.internal_note_updated_by,
		fingerprint=feedback.fingerprint,
		dedupe_window_minutes=feedback.dedupe_window_minutes,
		occurrence_count=max(1, feedback.occurrence_count),
		last_seen_at=feedback.last_seen_at,
	)

def _parse_feedback_filter_values(
	raw_value: str | None,
	*,
	allowed_values: tuple[str, ...],
	field_name: str,
) -> set[str] | None:
	if raw_value is None:
		return None

	parsed_values = {
		item.strip().upper()
		for item in raw_value.split(",")
		if item.strip()
	}
	if not parsed_values:
		return None

	invalid_values = sorted(value for value in parsed_values if value not in allowed_values)
	if invalid_values:
		raise HTTPException(
			status_code=400,
			detail=(
				f"{field_name} contains invalid values: {', '.join(invalid_values)}. "
				f"Allowed: {', '.join(allowed_values)}"
			),
		)
	return parsed_values

def _apply_feedback_status_transition(
	feedback: UserFeedback,
	*,
	target_status: str,
	actor_username: str,
) -> None:
	is_system_item = _is_system_feedback_item(feedback)
	if target_status == "SILENCED" and not is_system_item:
		raise HTTPException(status_code=400, detail="仅系统工单可设置为 SILENCED。")

	now = utc_now()
	if target_status == "RESOLVED":
		if feedback.resolved_at is None:
			feedback.resolved_at = now
		feedback.closed_by = actor_username
		feedback.status = "RESOLVED"
		return

	if feedback.resolved_at is not None:
		feedback.resolved_at = None
		feedback.closed_by = None

	if target_status == "ACKED":
		feedback.acknowledged_at = now
		feedback.acknowledged_by = actor_username
	elif target_status == "OPEN":
		feedback.acknowledged_at = None
		feedback.acknowledged_by = None

	feedback.status = target_status

def _build_admin_feedback_list(
	*,
	items: list[UserFeedback],
	status_filter: set[str] | None,
	priority_filter: set[str] | None,
	page: int,
	page_size: int,
) -> AdminFeedbackListRead:
	filtered_items = items
	if status_filter is not None:
		filtered_items = [
			item for item in filtered_items if _derive_feedback_status(item) in status_filter
		]
	if priority_filter is not None:
		filtered_items = [
			item
			for item in filtered_items
			if _normalize_feedback_choice(item.priority, FEEDBACK_PRIORITIES, "MEDIUM")
			in priority_filter
		]

	sorted_items = sorted(filtered_items, key=_feedback_sort_key)
	total_items = len(sorted_items)
	offset = (page - 1) * page_size
	page_items = sorted_items[offset: offset + page_size]
	return AdminFeedbackListRead(
		items=[_to_admin_feedback_read(item) for item in page_items],
		total=total_items,
		page=page,
		page_size=page_size,
		has_more=offset + page_size < total_items,
	)

def submit_feedback(
	payload: UserFeedbackCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> UserFeedbackRead:
	requested_category = _normalize_feedback_choice(
		payload.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	) if payload.category is not None else None
	requested_priority = _normalize_feedback_choice(
		payload.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	) if payload.priority is not None else None
	requested_source = _normalize_feedback_choice(
		payload.source,
		FEEDBACK_SOURCES,
		"USER",
	) if payload.source is not None else None
	requested_fingerprint = (payload.fingerprint or "").strip() or None
	requested_dedupe_window_minutes = payload.dedupe_window_minutes

	if current_user.username == "admin":
		category = requested_category
		source = requested_source

		if category is None:
			if source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}:
				category = "SYSTEM_TASK"
			else:
				category = "USER_REQUEST"

		if source is None:
			source = "SYSTEM" if category.startswith("SYSTEM_") else "ADMIN"

		# System feedback must never remain USER source, otherwise it can hit user daily limit.
		if category.startswith("SYSTEM_") and source == "USER":
			source = "SYSTEM"

		if category == "USER_REQUEST" and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}:
			category = "SYSTEM_TASK"

		default_priority = "MEDIUM"
		if category == "SYSTEM_ALERT":
			default_priority = "HIGH"
		elif category == "SYSTEM_HEARTBEAT":
			default_priority = "LOW"
		priority = requested_priority or default_priority
	else:
		category = "USER_REQUEST"
		priority = "MEDIUM"
		source = "USER"
		requested_fingerprint = None
		requested_dedupe_window_minutes = None

	if source == "USER" and category == "USER_REQUEST":
		day_start, day_end = _feedback_day_window()
		submission_count = len(
			list(
				session.exec(
					select(UserFeedback.id).where(
						UserFeedback.user_id == current_user.username,
						UserFeedback.created_at >= day_start,
						UserFeedback.created_at < day_end,
					),
				),
			),
		)
		if submission_count >= MAX_DAILY_FEEDBACK_SUBMISSIONS:
			raise HTTPException(status_code=429, detail="今日反馈次数已达上限，请明天再试。")

	now = utc_now()
	if (
		current_user.username == "admin"
		and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}
		and requested_fingerprint is not None
		and requested_dedupe_window_minutes is not None
	):
		window_start = now - timedelta(minutes=requested_dedupe_window_minutes)
		existing_feedback = session.exec(
			select(UserFeedback)
			.where(
				UserFeedback.user_id == current_user.username,
				UserFeedback.source == source,
				UserFeedback.category == category,
				UserFeedback.fingerprint == requested_fingerprint,
				UserFeedback.created_at >= window_start,
			)
			.order_by(UserFeedback.created_at.desc(), UserFeedback.id.desc()),
		).first()
		if existing_feedback is not None:
			existing_feedback.occurrence_count = max(1, existing_feedback.occurrence_count) + 1
			existing_feedback.last_seen_at = now
			if existing_feedback.resolved_at is not None and _is_system_feedback_item(existing_feedback):
				existing_feedback.resolved_at = None
				existing_feedback.closed_by = None
				existing_feedback.status = "OPEN"
			session.add(existing_feedback)
			session.commit()
			session.refresh(existing_feedback)
			return _to_feedback_read(existing_feedback)

	auto_resolve = (
		category == "SYSTEM_HEARTBEAT"
		and priority == "LOW"
		and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}
	)
	feedback = UserFeedback(
		user_id=current_user.username,
		message=payload.message,
		category=category,
		priority=priority,
		source=source,
		status="RESOLVED" if auto_resolve else "OPEN",
		resolved_at=now if auto_resolve else None,
		closed_by="system-auto" if auto_resolve else None,
		fingerprint=requested_fingerprint,
		dedupe_window_minutes=requested_dedupe_window_minutes,
		occurrence_count=1,
		last_seen_at=now,
	)
	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_feedback_read(feedback)

def list_feedback_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = list(
		session.exec(
			select(UserFeedback)
			.where(UserFeedback.user_id == current_user.username)
			.order_by(UserFeedback.created_at.desc()),
		),
	)
	visible_feedback_items = [
		feedback for feedback in feedback_items if (feedback.id or 0) not in hidden_feedback_ids
	]
	return [_to_feedback_read(feedback) for feedback in visible_feedback_items]

def mark_feedback_seen_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = list(
		session.exec(
			select(UserFeedback).where(
				UserFeedback.user_id == current_user.username,
				UserFeedback.replied_at.is_not(None),
				UserFeedback.reply_seen_at.is_(None),
			),
		),
	)
	feedback_items = [
		item for item in feedback_items if (item.id or 0) not in hidden_feedback_ids
	]
	if not feedback_items:
		return ActionMessageRead(message="没有新的回复。")

	now = utc_now()
	for feedback in feedback_items:
		feedback.reply_seen_at = now
		session.add(feedback)

	session.commit()
	return ActionMessageRead(message="消息已标记为已读。")

def get_feedback_summary(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> FeedbackSummaryRead:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	if current_user.username == "admin":
		inbox_count = len(
			[
				feedback_id
				for feedback_id in session.exec(
					select(UserFeedback.id).where(UserFeedback.resolved_at.is_(None)),
				)
				if int(feedback_id) not in hidden_feedback_ids
			],
		)
		return FeedbackSummaryRead(inbox_count=inbox_count, mode="admin-open")

	_ensure_release_note_deliveries_for_user(session, current_user.username)
	hidden_release_note_delivery_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="RELEASE_NOTE",
	)
	feedback_unread_count = len(
		[
			feedback_id
			for feedback_id in session.exec(
				select(UserFeedback.id).where(
					UserFeedback.user_id == current_user.username,
					UserFeedback.replied_at.is_not(None),
					UserFeedback.reply_seen_at.is_(None),
				),
			)
			if int(feedback_id) not in hidden_feedback_ids
		],
	)
	release_note_unread_count = 1 if any(
		int(delivery_id) not in hidden_release_note_delivery_ids
		for delivery_id in session.exec(
			select(ReleaseNoteDelivery.id).where(
				ReleaseNoteDelivery.user_id == current_user.username,
				ReleaseNoteDelivery.seen_at.is_(None),
			),
		)
	) else 0
	return FeedbackSummaryRead(
		inbox_count=feedback_unread_count + release_note_unread_count,
		mode="user-unread",
	)

def hide_inbox_message_for_current_user(
	payload: InboxMessageHideCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	message_kind = payload.message_kind
	message_id = payload.message_id

	if message_kind == "FEEDBACK":
		feedback = session.get(UserFeedback, message_id)
		if feedback is None:
			raise HTTPException(status_code=404, detail="消息不存在。")
		if current_user.username != "admin" and feedback.user_id != current_user.username:
			raise HTTPException(status_code=403, detail="无权移除该消息。")
	elif message_kind == "RELEASE_NOTE":
		delivery = session.get(ReleaseNoteDelivery, message_id)
		if delivery is None:
			raise HTTPException(status_code=404, detail="消息不存在。")
		if delivery.user_id != current_user.username:
			raise HTTPException(status_code=403, detail="无权移除该消息。")
	else:
		raise HTTPException(status_code=400, detail="message_kind 无效。")

	existing_visibility = session.exec(
		select(InboxMessageVisibility).where(
			InboxMessageVisibility.user_id == current_user.username,
			InboxMessageVisibility.message_kind == message_kind,
			InboxMessageVisibility.message_id == message_id,
		),
	).first()
	if existing_visibility is not None:
		return ActionMessageRead(message="消息已从当前列表移除。")

	visibility = InboxMessageVisibility(
		user_id=current_user.username,
		message_kind=message_kind,
		message_id=message_id,
	)
	session.add(visibility)
	session.commit()
	return ActionMessageRead(message="消息已从当前列表移除。")

def list_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	_require_admin_user(current_user)
	feedback_items = list(session.exec(select(UserFeedback)))
	feedback_items = sorted(feedback_items, key=_feedback_sort_key)
	return [
		_to_feedback_read(feedback)
		for feedback in feedback_items
	]

def list_user_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=50, ge=1, le=200),
	status: str | None = Query(default=None),
	priority: str | None = Query(default=None),
) -> AdminFeedbackListRead:
	_require_admin_user(current_user)
	status_filter = _parse_feedback_filter_values(
		status,
		allowed_values=FEEDBACK_STATUSES,
		field_name="status",
	)
	priority_filter = _parse_feedback_filter_values(
		priority,
		allowed_values=FEEDBACK_PRIORITIES,
		field_name="priority",
	)
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = [
		feedback
		for feedback in session.exec(select(UserFeedback))
		if _is_user_feedback_item(feedback) and (feedback.id or 0) not in hidden_feedback_ids
	]
	return _build_admin_feedback_list(
		items=feedback_items,
		status_filter=status_filter,
		priority_filter=priority_filter,
		page=page,
		page_size=page_size,
	)

def list_system_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=50, ge=1, le=200),
	status: str | None = Query(default=None),
	priority: str | None = Query(default=None),
) -> AdminFeedbackListRead:
	_require_admin_user(current_user)
	status_filter = _parse_feedback_filter_values(
		status,
		allowed_values=FEEDBACK_STATUSES,
		field_name="status",
	)
	priority_filter = _parse_feedback_filter_values(
		priority,
		allowed_values=FEEDBACK_PRIORITIES,
		field_name="priority",
	)
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = [
		feedback
		for feedback in session.exec(select(UserFeedback))
		if _is_system_feedback_item(feedback) and (feedback.id or 0) not in hidden_feedback_ids
	]
	return _build_admin_feedback_list(
		items=feedback_items,
		status_filter=status_filter,
		priority_filter=priority_filter,
		page=page,
		page_size=page_size,
	)

def reply_to_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackReplyUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")
	if _is_system_feedback_item(feedback):
		raise HTTPException(
			status_code=400,
			detail="系统工单无需回复，请直接关闭或调整状态。",
		)

	now = utc_now()
	feedback.reply_message = payload.reply_message
	feedback.replied_at = now
	feedback.replied_by = current_user.username
	feedback.reply_seen_at = None
	if payload.close and feedback.resolved_at is None:
		feedback.resolved_at = now
		feedback.closed_by = current_user.username
		feedback.status = "RESOLVED"
	else:
		feedback.status = "IN_PROGRESS"
	session.add(feedback)
	session.commit()
	session.refresh(feedback)

	return _to_admin_feedback_read(feedback)

def close_feedback_for_admin(
	feedback_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")

	if feedback.resolved_at is None:
		feedback.resolved_at = utc_now()
		feedback.closed_by = current_user.username
		feedback.status = "RESOLVED"
		session.add(feedback)
		session.commit()
		session.refresh(feedback)

	return _to_admin_feedback_read(feedback)

def acknowledge_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackAcknowledgeUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> AdminFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")
	if feedback.resolved_at is not None:
		raise HTTPException(status_code=400, detail="已关闭工单无法确认。")

	feedback.status = "ACKED"
	feedback.acknowledged_at = utc_now()
	feedback.acknowledged_by = current_user.username
	if "assignee" in payload.model_fields_set:
		feedback.assignee = payload.assignee
	if "ack_deadline" in payload.model_fields_set:
		feedback.ack_deadline = payload.ack_deadline
	if "internal_note" in payload.model_fields_set:
		feedback.internal_note = payload.internal_note
		feedback.internal_note_updated_at = utc_now()
		feedback.internal_note_updated_by = current_user.username
	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_admin_feedback_read(feedback)

def classify_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackClassifyUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")

	if "category" in payload.model_fields_set:
		feedback.category = payload.category
	if "priority" in payload.model_fields_set:
		feedback.priority = payload.priority
	if "source" in payload.model_fields_set:
		feedback.source = payload.source
	if "status" in payload.model_fields_set:
		_apply_feedback_status_transition(
			feedback,
			target_status=payload.status or "OPEN",
			actor_username=current_user.username,
		)
	if "assignee" in payload.model_fields_set:
		feedback.assignee = payload.assignee
	if "ack_deadline" in payload.model_fields_set:
		feedback.ack_deadline = payload.ack_deadline
	if "internal_note" in payload.model_fields_set:
		feedback.internal_note = payload.internal_note
		feedback.internal_note_updated_at = utc_now()
		feedback.internal_note_updated_by = current_user.username

	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_admin_feedback_read(feedback)

__all__ = ['_normalize_feedback_choice', '_is_system_feedback_item', '_is_user_feedback_item', '_derive_feedback_status', '_feedback_sort_key', '_to_feedback_read', '_to_admin_feedback_read', '_parse_feedback_filter_values', '_apply_feedback_status_transition', '_build_admin_feedback_list', 'submit_feedback', 'list_feedback_for_current_user', 'mark_feedback_seen_for_current_user', 'get_feedback_summary', 'hide_inbox_message_for_current_user', 'list_feedback_for_admin', 'list_user_feedback_for_admin', 'list_system_feedback_for_admin', 'reply_to_feedback_for_admin', 'close_feedback_for_admin', 'acknowledge_feedback_for_admin', 'classify_feedback_for_admin']
