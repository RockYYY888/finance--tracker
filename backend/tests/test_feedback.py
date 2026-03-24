from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.main import (
	classify_feedback_for_admin,
	close_feedback_for_admin,
	create_release_note_for_admin,
	get_feedback_summary,
	list_feedback_for_admin,
	list_feedback_for_current_user,
	list_release_notes_for_current_user,
	mark_feedback_seen_for_current_user,
	mark_release_notes_seen_for_current_user,
	publish_release_note_for_admin,
	reply_to_feedback_for_admin,
	submit_feedback,
)
from app.models import ReleaseNoteDelivery, UserAccount, UserFeedback
from app.schemas import (
	AdminFeedbackClassifyUpdate,
	AdminFeedbackReplyUpdate,
	ReleaseNoteCreate,
	UserFeedbackCreate,
)


@pytest.fixture
def session(postgres_engine) -> Iterator[Session]:
	engine = postgres_engine
	with Session(engine) as db_session:
		yield db_session


def make_user(session: Session, username: str = "tester") -> UserAccount:
	user = UserAccount(
		username=username,
		password_digest="scrypt$16384$8$1$bc13ea73dad1a1d781e1bf06e769ccda$"
		"de4af04355be41e4ec61f7dc8b3c19fcc4fc940ba47784324063d4169d57e80a"
		"14cc1588be5fea70338075226ff4b32aafe37ab0a114d05b70e0a2364a0d2bf7",
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def test_submit_feedback_persists_feedback_for_current_user(session: Session) -> None:
	current_user = make_user(session)

	created_feedback = submit_feedback(
		UserFeedbackCreate(message="同步后投资类价格没有及时刷新。"),
		current_user,
		session,
	)

	persisted_feedback = session.exec(select(UserFeedback)).one()

	assert created_feedback.id == persisted_feedback.id
	assert created_feedback.message == persisted_feedback.message
	assert created_feedback.user_id == current_user.username
	assert persisted_feedback.user_id == current_user.username


def test_feedback_classification_defaults_and_system_submission(session: Session) -> None:
	admin_user = make_user(session, "admin")
	current_user = make_user(session, "classified_user")

	user_feedback = submit_feedback(
		UserFeedbackCreate(message="普通用户反馈默认应是中优先级。"),
		current_user,
		session,
	)
	assert user_feedback.category == "USER_REQUEST"
	assert user_feedback.priority == "MEDIUM"
	assert user_feedback.source == "USER"
	assert user_feedback.status == "OPEN"
	assert user_feedback.is_system is False

	for index in range(5):
		system_feedback = submit_feedback(
			UserFeedbackCreate(
				message=f"系统巡检心跳：{index}",
				category="SYSTEM_HEARTBEAT",
				priority="LOW",
				source="API_MONITOR",
			),
			admin_user,
			session,
		)
		assert system_feedback.user_id == "admin"
		assert system_feedback.category == "SYSTEM_HEARTBEAT"
		assert system_feedback.priority == "LOW"
		assert system_feedback.source == "API_MONITOR"
		assert system_feedback.is_system is True
		assert system_feedback.status == "RESOLVED"
		assert system_feedback.resolved_at is not None
		assert system_feedback.closed_by == "system-auto"

	system_alert_feedback = submit_feedback(
		UserFeedbackCreate(
			message="系统告警：行情源返回 5xx。",
			category="SYSTEM_ALERT",
			priority="HIGH",
			source="API_MONITOR",
		),
		admin_user,
		session,
	)
	assert system_alert_feedback.status == "OPEN"
	assert system_alert_feedback.resolved_at is None
	assert system_alert_feedback.closed_by is None


def test_admin_system_feedback_rewrites_user_source_and_skips_daily_limit(session: Session) -> None:
	admin_user = make_user(session, "admin")

	for index in range(5):
		created_feedback = submit_feedback(
			UserFeedbackCreate(
				message=f"系统巡检心跳兼容提交：{index}",
				category="SYSTEM_HEARTBEAT",
				priority="LOW",
				source="USER",
			),
			admin_user,
			session,
		)
		assert created_feedback.category == "SYSTEM_HEARTBEAT"
		assert created_feedback.source == "SYSTEM"
		assert created_feedback.is_system is True
		assert created_feedback.status == "RESOLVED"


def test_admin_user_request_with_user_source_still_has_daily_limit(session: Session) -> None:
	admin_user = make_user(session, "admin")

	for index in range(3):
		created_feedback = submit_feedback(
			UserFeedbackCreate(
				message=f"管理员模拟用户反馈第 {index + 1} 次。",
				source="USER",
			),
			admin_user,
			session,
		)
		assert created_feedback.category == "USER_REQUEST"
		assert created_feedback.source == "USER"

	with pytest.raises(HTTPException, match="今日反馈次数已达上限"):
		submit_feedback(
			UserFeedbackCreate(
				message="管理员模拟用户反馈第 4 次应受限。",
				source="USER",
			),
			admin_user,
			session,
		)


def test_submit_feedback_limits_each_user_to_three_per_day(session: Session) -> None:
	current_user = make_user(session)

	for index in range(3):
		created_feedback = submit_feedback(
			UserFeedbackCreate(message=f"第 {index + 1} 次问题反馈，用于验证每日上限。"),
			current_user,
			session,
		)
		assert created_feedback.id > 0

	with pytest.raises(HTTPException, match="今日反馈次数已达上限"):
		submit_feedback(
			UserFeedbackCreate(message="第 4 次提交应该被限制。"),
			current_user,
			session,
		)


def test_admin_can_list_and_close_feedback_without_affecting_daily_limit(session: Session) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "tester_2")

	created_feedback = submit_feedback(
		UserFeedbackCreate(message="一个需要处理的反馈。"),
		normal_user,
		session,
	)

	feedback_items = list_feedback_for_admin(admin_user, session, None)

	assert len(feedback_items) == 1
	assert feedback_items[0].id == created_feedback.id
	assert feedback_items[0].resolved_at is None

	closed_feedback = close_feedback_for_admin(created_feedback.id, admin_user, session, None)

	assert closed_feedback.user_id == normal_user.username
	assert closed_feedback.closed_by == "admin"
	assert closed_feedback.resolved_at is not None


def test_admin_can_reply_and_user_can_see_reply(session: Session) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "reply_user")

	created_feedback = submit_feedback(
		UserFeedbackCreate(message="希望看到更清晰的收益率说明。"),
		normal_user,
		session,
	)

	replied_feedback = reply_to_feedback_for_admin(
		created_feedback.id,
		AdminFeedbackReplyUpdate(reply_message="已收到，我们会在下一版优化说明文字。", close=True),
		admin_user,
		session,
		None,
	)

	user_feedback_items = list_feedback_for_current_user(normal_user, session, None)

	assert replied_feedback.reply_message == "已收到，我们会在下一版优化说明文字。"
	assert replied_feedback.replied_by == "admin"
	assert replied_feedback.resolved_at is not None
	assert len(user_feedback_items) == 1
	assert user_feedback_items[0].reply_message == "已收到，我们会在下一版优化说明文字。"


def test_admin_cannot_reply_to_system_feedback(session: Session) -> None:
	admin_user = make_user(session, "admin")

	system_feedback = submit_feedback(
		UserFeedbackCreate(
			message="API 巡检发现价格接口出现 5xx。",
			category="SYSTEM_ALERT",
			priority="HIGH",
			source="API_MONITOR",
		),
		admin_user,
		session,
	)

	with pytest.raises(HTTPException, match="系统工单无需回复"):
		reply_to_feedback_for_admin(
			system_feedback.id,
			AdminFeedbackReplyUpdate(reply_message="已记录告警，准备排查。", close=False),
			admin_user,
			session,
			None,
		)

	closed_feedback = close_feedback_for_admin(system_feedback.id, admin_user, session, None)
	assert closed_feedback.status == "RESOLVED"
	assert closed_feedback.resolved_at is not None


def test_admin_can_classify_and_reopen_feedback(session: Session) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "classify_user")

	created_feedback = submit_feedback(
		UserFeedbackCreate(message="请支持代理自动下单前的风控校验。"),
		normal_user,
		session,
	)

	classified_feedback = classify_feedback_for_admin(
		created_feedback.id,
		AdminFeedbackClassifyUpdate(
			category="SYSTEM_TASK",
			priority="HIGH",
			source="TRADING_AGENT",
			status="IN_PROGRESS",
		),
		admin_user,
		session,
		None,
	)
	assert classified_feedback.category == "SYSTEM_TASK"
	assert classified_feedback.priority == "HIGH"
	assert classified_feedback.source == "TRADING_AGENT"
	assert classified_feedback.status == "IN_PROGRESS"

	resolved_feedback = classify_feedback_for_admin(
		created_feedback.id,
		AdminFeedbackClassifyUpdate(status="RESOLVED"),
		admin_user,
		session,
		None,
	)
	assert resolved_feedback.status == "RESOLVED"
	assert resolved_feedback.resolved_at is not None
	assert resolved_feedback.closed_by == "admin"

	reopened_feedback = classify_feedback_for_admin(
		created_feedback.id,
		AdminFeedbackClassifyUpdate(status="OPEN"),
		admin_user,
		session,
		None,
	)
	assert reopened_feedback.status == "OPEN"
	assert reopened_feedback.resolved_at is None


def test_feedback_summary_counts_pending_items_for_admin_and_user(session: Session) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "summary_user")

	submit_feedback(
		UserFeedbackCreate(message="第一条反馈。"),
		normal_user,
		session,
	)
	submit_feedback(
		UserFeedbackCreate(message="第二条反馈。"),
		normal_user,
		session,
	)

	admin_summary = get_feedback_summary(admin_user, session, None)
	user_summary_before_reply = get_feedback_summary(normal_user, session, None)

	reply_to_feedback_for_admin(
		1,
		AdminFeedbackReplyUpdate(reply_message="已收到。", close=False),
		admin_user,
		session,
		None,
	)

	user_summary_after_reply = get_feedback_summary(normal_user, session, None)
	mark_feedback_seen_for_current_user(normal_user, session, None)
	user_summary_after_seen = get_feedback_summary(normal_user, session, None)

	assert admin_summary.mode == "admin-open"
	assert admin_summary.inbox_count == 2
	assert user_summary_before_reply.mode == "user-unread"
	assert user_summary_before_reply.inbox_count == 0
	assert user_summary_after_reply.inbox_count == 1
	assert user_summary_after_seen.inbox_count == 0


def test_release_note_publish_pushes_station_message_to_users(session: Session) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "release_note_user")

	created_release_note = create_release_note_for_admin(
		ReleaseNoteCreate(
			version="0.2.0",
			title="收益图可读性优化",
			content="新增零轴分区与图例，提升正负收益辨识度。",
			source_feedback_ids=[5, 6],
		),
		admin_user,
		session,
		None,
	)
	assert created_release_note.published_at is None

	published_release_note = publish_release_note_for_admin(
		created_release_note.id,
		admin_user,
		session,
		None,
	)
	assert published_release_note.published_at is not None
	assert published_release_note.delivery_count == 1

	user_release_notes = list_release_notes_for_current_user(normal_user, session, None)
	assert len(user_release_notes) == 1
	assert user_release_notes[0].version == "0.2.0"
	assert user_release_notes[0].source_feedback_ids == [5, 6]
	assert user_release_notes[0].seen_at is None

	user_summary = get_feedback_summary(normal_user, session, None)
	assert user_summary.inbox_count == 1

	mark_release_notes_seen_for_current_user(normal_user, session, None)
	user_summary_after_seen = get_feedback_summary(normal_user, session, None)
	assert user_summary_after_seen.inbox_count == 0


def test_release_note_stream_keeps_single_user_message_after_multiple_publishes(
	session: Session,
) -> None:
	admin_user = make_user(session, "admin")
	normal_user = make_user(session, "release_stream_user")

	first_note = create_release_note_for_admin(
		ReleaseNoteCreate(
			version="0.4.0",
			title="第一批优化",
			content="修复趋势图的动态中线逻辑。",
			source_feedback_ids=[4],
		),
		admin_user,
		session,
		None,
	)
	publish_release_note_for_admin(first_note.id, admin_user, session, None)
	mark_release_notes_seen_for_current_user(normal_user, session, None)

	second_note = create_release_note_for_admin(
		ReleaseNoteCreate(
			version="0.5.0",
			title="第二批优化",
			content="统一更新日志推送为单条流式消息。",
			source_feedback_ids=[5],
		),
		admin_user,
		session,
		None,
	)
	publish_release_note_for_admin(second_note.id, admin_user, session, None)

	user_release_notes = list_release_notes_for_current_user(normal_user, session, None)
	assert len(user_release_notes) == 1
	assert user_release_notes[0].version == "0.5.0"
	assert user_release_notes[0].title == "产品更新日志（持续更新）"
	assert "## v0.5.0" in user_release_notes[0].content
	assert "## v0.4.0" in user_release_notes[0].content
	assert user_release_notes[0].seen_at is None

	deliveries = list(
		session.exec(
			select(ReleaseNoteDelivery).where(ReleaseNoteDelivery.user_id == normal_user.username),
		),
	)
	assert len(deliveries) == 1

	user_summary = get_feedback_summary(normal_user, session, None)
	assert user_summary.inbox_count == 1


def test_release_note_version_must_be_unique(session: Session) -> None:
	admin_user = make_user(session, "admin")

	create_release_note_for_admin(
		ReleaseNoteCreate(
			version="0.3.0",
			title="第一版日志",
			content="第一版更新内容",
		),
		admin_user,
		session,
		None,
	)

	with pytest.raises(HTTPException, match="该版本号已存在"):
		create_release_note_for_admin(
			ReleaseNoteCreate(
				version="0.3.0",
				title="重复版本号日志",
				content="重复版本号不应允许创建。",
			),
			admin_user,
			session,
			None,
		)
