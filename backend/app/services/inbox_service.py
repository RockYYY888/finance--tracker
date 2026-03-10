from __future__ import annotations

from sqlmodel import Session, select

from app.models import INBOX_MESSAGE_KINDS, InboxMessageVisibility

def _load_hidden_message_ids(
	session: Session,
	*,
	user_id: str,
	message_kind: str,
) -> set[int]:
	if message_kind not in INBOX_MESSAGE_KINDS:
		return set()

	return {
		int(record_id)
		for record_id in session.exec(
			select(InboxMessageVisibility.message_id).where(
				InboxMessageVisibility.user_id == user_id,
				InboxMessageVisibility.message_kind == message_kind,
			),
		)
	}

__all__ = ['_load_hidden_message_ids']
