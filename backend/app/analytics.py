from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Iterable, TypeVar
from zoneinfo import ZoneInfo

from app.models import HoldingPerformanceSnapshot, PortfolioSnapshot
from app.schemas import TimelinePoint

SeriesSnapshot = TypeVar("SeriesSnapshot")
DISPLAY_TIMEZONE = ZoneInfo("Asia/Shanghai")


def _coerce_utc_datetime(value: datetime) -> datetime:
	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)

	return value.astimezone(timezone.utc)


def _bucket_label(timestamp: datetime, granularity: str) -> str:
	normalized_timestamp = _coerce_utc_datetime(timestamp).astimezone(DISPLAY_TIMEZONE)
	if granularity == "hour":
		return normalized_timestamp.strftime("%m-%d %H:00")
	if granularity == "day":
		return normalized_timestamp.strftime("%m-%d")
	if granularity == "month":
		return normalized_timestamp.strftime("%Y-%m")
	if granularity == "year":
		return normalized_timestamp.strftime("%Y")
	msg = f"Unsupported granularity: {granularity}"
	raise ValueError(msg)


def _build_timeline_from_snapshots(
	snapshots: Iterable[SeriesSnapshot],
	granularity: str,
	get_created_at: Callable[[SeriesSnapshot], datetime],
	get_value: Callable[[SeriesSnapshot], float],
) -> list[TimelinePoint]:
	buckets: dict[str, SeriesSnapshot] = {}
	for snapshot in snapshots:
		snapshot_created_at = _coerce_utc_datetime(get_created_at(snapshot))
		label = _bucket_label(snapshot_created_at, granularity)
		current = buckets.get(label)
		current_created_at = (
			_coerce_utc_datetime(get_created_at(current)) if current is not None else None
		)
		if current is None or (
			current_created_at is not None and snapshot_created_at >= current_created_at
		):
			buckets[label] = snapshot

	return [
		TimelinePoint(label=label, value=round(get_value(snapshot), 2))
		for label, snapshot in sorted(
			buckets.items(),
			key=lambda item: _coerce_utc_datetime(get_created_at(item[1])),
		)
	]


def build_timeline(
	snapshots: Iterable[PortfolioSnapshot],
	granularity: str,
) -> list[TimelinePoint]:
	"""Collapse snapshots to the latest point in each reporting bucket."""
	return _build_timeline_from_snapshots(
		snapshots,
		granularity,
		get_created_at=lambda snapshot: snapshot.created_at,
		get_value=lambda snapshot: snapshot.total_value_cny,
	)


def build_return_timeline(
	snapshots: Iterable[HoldingPerformanceSnapshot],
	granularity: str,
) -> list[TimelinePoint]:
	return _build_timeline_from_snapshots(
		snapshots,
		granularity,
		get_created_at=lambda snapshot: snapshot.created_at,
		get_value=lambda snapshot: snapshot.return_pct,
	)
