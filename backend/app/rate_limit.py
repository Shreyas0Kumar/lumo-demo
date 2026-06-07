from __future__ import annotations

import threading
from datetime import datetime, timezone


class DailyIpLimiter:
    """In-memory per-IP daily counter.

    Counts reset at UTC midnight. Single-process only (the demo runs one
    uvicorn worker); if you scale to multiple workers, move this to Redis.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._day: str | None = None
        self._counts: dict[str, int] = {}

    def _roll(self, today: str) -> None:
        if self._day != today:
            self._day = today
            self._counts.clear()

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def peek(self, ip: str) -> int:
        with self._lock:
            self._roll(self._today())
            return self._counts.get(ip, 0)

    def consume(self, ip: str, limit: int) -> tuple[bool, int]:
        """Consume one unit for ``ip``.

        Returns ``(allowed, remaining)``. ``remaining`` is ``-1`` when the
        limit is disabled (``limit <= 0``).
        """
        if limit <= 0:
            return True, -1
        with self._lock:
            self._roll(self._today())
            used = self._counts.get(ip, 0)
            if used >= limit:
                return False, 0
            self._counts[ip] = used + 1
            return True, max(0, limit - (used + 1))


limiter = DailyIpLimiter()
