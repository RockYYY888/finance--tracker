from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine, select

from app.main import (
	close_feedback_for_admin,
	get_feedback_summary,
	list_feedback_for_admin,
	list_feedback_for_current_user,
	reply_to_feedback_for_admin,
	submit_feedback,
)
from app.models import UserAccount, UserFeedback
from app.schemas import AdminFeedbackReplyUpdate, UserFeedbackCreate


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'feedback-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)

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

	user_summary = get_feedback_summary(normal_user, session, None)
	admin_summary = get_feedback_summary(admin_user, session, None)

	assert user_summary.mode == "user-pending"
	assert user_summary.inbox_count == 2
	assert admin_summary.mode == "admin-open"
	assert admin_summary.inbox_count == 2
