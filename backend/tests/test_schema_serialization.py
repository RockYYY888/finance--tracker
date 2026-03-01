from datetime import datetime, timezone

from app.schemas import SecurityHoldingRead, UserFeedbackRead


def test_user_feedback_read_serializes_naive_timestamps_as_explicit_utc() -> None:
	record = UserFeedbackRead(
		id=1,
		user_id="tester",
		message="反馈内容",
		created_at=datetime(2026, 3, 1, 4, 20, 51, 753577),
	)

	payload = record.model_dump(mode="json")

	assert payload["created_at"] == "2026-03-01T04:20:51.753577Z"


def test_security_holding_read_serializes_aware_timestamps_with_utc_marker() -> None:
	record = SecurityHoldingRead(
		id=1,
		symbol="AAPL",
		name="Apple Inc.",
		quantity=1,
		fallback_currency="USD",
		market="US",
		last_updated=datetime(2026, 3, 1, 4, 20, 51, tzinfo=timezone.utc),
	)

	payload = record.model_dump(mode="json")

	assert payload["last_updated"] == "2026-03-01T04:20:51Z"
