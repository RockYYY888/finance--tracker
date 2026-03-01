from datetime import datetime, timezone

import app.main as main

from app.analytics import build_timeline
from app.models import PortfolioSnapshot


def make_snapshot(timestamp: datetime, total: float) -> PortfolioSnapshot:
	return PortfolioSnapshot(created_at=timestamp, total_value_cny=total)


def test_build_timeline_uses_latest_snapshot_per_hour_bucket() -> None:
	snapshots = [
		make_snapshot(datetime(2026, 2, 28, 9, 0, tzinfo=timezone.utc), 1000),
		make_snapshot(datetime(2026, 2, 28, 9, 30, tzinfo=timezone.utc), 1200),
		make_snapshot(datetime(2026, 2, 28, 10, 0, tzinfo=timezone.utc), 1400),
	]

	series = build_timeline(snapshots, "hour")

	assert [point.label for point in series] == ["02-28 09:00", "02-28 10:00"]
	assert [point.value for point in series] == [1200, 1400]


def test_build_timeline_uses_latest_snapshot_per_day_bucket() -> None:
	snapshots = [
		make_snapshot(datetime(2026, 2, 27, 10, 0, tzinfo=timezone.utc), 900),
		make_snapshot(datetime(2026, 2, 27, 18, 0, tzinfo=timezone.utc), 1100),
		make_snapshot(datetime(2026, 2, 28, 10, 0, tzinfo=timezone.utc), 1200),
	]

	series = build_timeline(snapshots, "day")

	assert [point.label for point in series] == ["02-27", "02-28"]
	assert [point.value for point in series] == [1100, 1200]


def test_build_timeline_uses_latest_snapshot_per_month_bucket() -> None:
	snapshots = [
		make_snapshot(datetime(2025, 12, 1, 10, 0, tzinfo=timezone.utc), 900),
		make_snapshot(datetime(2025, 12, 18, 18, 0, tzinfo=timezone.utc), 1100),
		make_snapshot(datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc), 1200),
	]

	series = build_timeline(snapshots, "month")

	assert [point.label for point in series] == ["2025-12", "2026-01"]
	assert [point.value for point in series] == [1100, 1200]


def test_build_timeline_uses_latest_snapshot_per_year_bucket() -> None:
	snapshots = [
		make_snapshot(datetime(2025, 2, 1, 10, 0, tzinfo=timezone.utc), 900),
		make_snapshot(datetime(2025, 12, 18, 18, 0, tzinfo=timezone.utc), 1100),
		make_snapshot(datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc), 1200),
	]

	series = build_timeline(snapshots, "year")

	assert [point.label for point in series] == ["2025", "2026"]
	assert [point.value for point in series] == [1100, 1200]


def test_build_timeline_handles_naive_and_aware_snapshot_timestamps() -> None:
	snapshots = [
		make_snapshot(datetime(2026, 3, 1, 3, 15), 1000),
		make_snapshot(datetime(2026, 3, 1, 3, 45, tzinfo=timezone.utc), 1250),
	]

	series = build_timeline(snapshots, "hour")

	assert [point.label for point in series] == ["03-01 03:00"]
	assert [point.value for point in series] == [1250]


def test_is_current_minute_matches_same_bucket() -> None:
	now = datetime(2026, 3, 1, 3, 15, 42, tzinfo=timezone.utc)
	cached_at = datetime(2026, 3, 1, 3, 15, 1, tzinfo=timezone.utc)

	assert main._is_current_minute(cached_at, now) is True


def test_is_current_minute_rejects_previous_bucket() -> None:
	now = datetime(2026, 3, 1, 3, 15, 0, tzinfo=timezone.utc)
	cached_at = datetime(2026, 3, 1, 3, 14, 59, tzinfo=timezone.utc)

	assert main._is_current_minute(cached_at, now) is False
