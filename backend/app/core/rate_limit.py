from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from time import time


@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int


class InMemoryRateLimiter:
    def __init__(self, window_sec: int, max_requests: int) -> None:
        self.window_sec = window_sec
        self.max_requests = max_requests
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> RateLimitResult:
        now = time()
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window_sec:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                return RateLimitResult(allowed=False, remaining=0)

            bucket.append(now)
            remaining = self.max_requests - len(bucket)
            return RateLimitResult(allowed=True, remaining=remaining)
