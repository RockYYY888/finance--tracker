from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from app.models import PortfolioSnapshot
from app.schemas import TimelinePoint


def _coerce_utc_datetime(value: datetime) -> datetime:
	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)

	return value.astimezone(timezone.utc)


def _bucket_label(timestamp: datetime, granularity: str) -> str:
	normalized_timestamp = _coerce_utc_datetime(timestamp)
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


def build_timeline(
	snapshots: Iterable[PortfolioSnapshot],
	granularity: str,
) -> list[TimelinePoint]:
	"""Collapse snapshots to the latest point in each reporting bucket."""
	buckets: dict[str, PortfolioSnapshot] = {}
	for snapshot in snapshots:
		label = _bucket_label(snapshot.created_at, granularity)
		current = buckets.get(label)
		snapshot_created_at = _coerce_utc_datetime(snapshot.created_at)
		current_created_at = (
			_coerce_utc_datetime(current.created_at) if current is not None else None
		)
		if current is None or (
			current_created_at is not None and snapshot_created_at >= current_created_at
		):
			buckets[label] = snapshot

	return [
		TimelinePoint(label=label, value=round(snapshot.total_value_cny, 2))
		for label, snapshot in sorted(
			buckets.items(),
			key=lambda item: _coerce_utc_datetime(item[1].created_at),
		)
	]
