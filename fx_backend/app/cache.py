from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Hashable


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class TTLCache:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._entries: dict[Hashable, _CacheEntry] = {}
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Any | None:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if not entry:
                return None
            if entry.expires_at <= now:
                self._entries.pop(key, None)
                return None
            return entry.value

    def set(self, key: Hashable, value: Any, ttl_seconds: int | None = None) -> Any:
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_seconds
        expires_at = time.monotonic() + ttl
        with self._lock:
            self._entries[key] = _CacheEntry(value=value, expires_at=expires_at)
        return value

    def get_or_set(self, key: Hashable, factory: Callable[[], Any], ttl_seconds: int | None = None) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        value = factory()
        return self.set(key, value, ttl_seconds)
