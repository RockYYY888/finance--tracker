from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Callable, Generic, TypeVar

CacheValue = TypeVar("CacheValue")


@dataclass(slots=True)
class CacheEntry(Generic[CacheValue]):
	value: CacheValue
	expires_at: float


class TTLCache(Generic[CacheValue]):
	"""Store values in-process while retaining the last stale value for fallback."""

	def __init__(self, now: Callable[[], float] | None = None) -> None:
		self._entries: dict[str, CacheEntry[CacheValue]] = {}
		self._now = now or monotonic

	def get(self, key: str) -> CacheValue | None:
		entry = self._entries.get(key)
		if entry is None:
			return None
		if entry.expires_at <= self._now():
			return None
		return entry.value

	def get_stale(self, key: str) -> CacheValue | None:
		entry = self._entries.get(key)
		if entry is None:
			return None
		return entry.value

	def set(self, key: str, value: CacheValue, ttl_seconds: float) -> CacheValue:
		self._entries[key] = CacheEntry(
			value=value,
			expires_at=self._now() + ttl_seconds,
		)
		return value

	def clear(self) -> None:
		self._entries.clear()
