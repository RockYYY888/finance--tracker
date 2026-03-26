from __future__ import annotations

import base64
from dataclasses import dataclass
import pickle
from time import monotonic, time
from typing import Callable, Generic, TypeVar

from redis import Redis

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

	def expire_all(self) -> None:
		"""Mark every entry expired while keeping stale values available for fallback."""
		now = self._now()
		for entry in self._entries.values():
			entry.expires_at = now


class RedisBackedTTLCache(Generic[CacheValue]):
	"""Store cache entries in Redis while retaining stale values for fallback."""

	def __init__(
		self,
		redis_client: Redis,
		prefix: str,
		now: Callable[[], float] | None = None,
		stale_ttl_seconds: float | None = None,
	) -> None:
		self._redis = redis_client
		self._prefix = prefix
		self._now = now or time
		self._stale_ttl_seconds = stale_ttl_seconds

	def _entry_key(self, key: str) -> str:
		encoded_key = base64.urlsafe_b64encode(key.encode("utf-8")).decode("ascii")
		return f"{self._prefix}:{encoded_key}"

	def _load_entry(self, key: str) -> CacheEntry[CacheValue] | None:
		raw_value = self._redis.get(self._entry_key(key))
		if raw_value is None:
			return None
		return pickle.loads(raw_value)

	def get(self, key: str) -> CacheValue | None:
		entry = self._load_entry(key)
		if entry is None:
			return None
		if entry.expires_at <= self._now():
			return None
		return entry.value

	def get_stale(self, key: str) -> CacheValue | None:
		entry = self._load_entry(key)
		if entry is None:
			return None
		return entry.value

	def set(self, key: str, value: CacheValue, ttl_seconds: float) -> CacheValue:
		entry = CacheEntry(
			value=value,
			expires_at=self._now() + ttl_seconds,
		)
		redis_ttl_seconds = self._stale_ttl_seconds
		if redis_ttl_seconds is None:
			redis_ttl_seconds = max(float(ttl_seconds) * 60, 60 * 60)
		self._redis.set(
			self._entry_key(key),
			pickle.dumps(entry, protocol=pickle.HIGHEST_PROTOCOL),
			ex=max(1, int(redis_ttl_seconds)),
		)
		return value

	def clear(self) -> None:
		keys = list(self._redis.scan_iter(f"{self._prefix}:*"))
		if keys:
			self._redis.delete(*keys)

	def expire_all(self) -> None:
		"""Mark every entry expired while keeping stale values available for fallback."""
		now = self._now()
		for redis_key in self._redis.scan_iter(f"{self._prefix}:*"):
			raw_value = self._redis.get(redis_key)
			if raw_value is None:
				continue
			entry: CacheEntry[CacheValue] = pickle.loads(raw_value)
			entry.expires_at = now
			redis_ttl_seconds = self._stale_ttl_seconds or 60 * 60
			self._redis.set(
				redis_key,
				pickle.dumps(entry, protocol=pickle.HIGHEST_PROTOCOL),
				ex=max(1, int(redis_ttl_seconds)),
			)
