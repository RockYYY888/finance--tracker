from __future__ import annotations

from datetime import datetime
from typing import Iterable

from app.models import PortfolioSnapshot
from app.schemas import TimelinePoint


def _bucket_label(timestamp: datetime, granularity: str) -> str:
	if granularity == "hour":
		return timestamp.strftime("%m-%d %H:00")
	if granularity == "day":
		return timestamp.strftime("%m-%d")
	if granularity == "month":
		return timestamp.strftime("%Y-%m")
	if granularity == "year":
		return timestamp.strftime("%Y")
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
		if current is None or snapshot.created_at >= current.created_at:
			buckets[label] = snapshot

	return [
		TimelinePoint(label=label, value=round(snapshot.total_value_cny, 2))
		for label, snapshot in sorted(buckets.items(), key=lambda item: item[1].created_at)
	]
