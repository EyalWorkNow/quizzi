from collections import defaultdict
from threading import Lock


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, int] = defaultdict(int)
        self._lock = Lock()

    def connect(self, session_id: str) -> None:
        with self._lock:
            self._connections[session_id] += 1

    def disconnect(self, session_id: str) -> None:
        with self._lock:
            self._connections[session_id] = max(0, self._connections[session_id] - 1)

    def active(self, session_id: str) -> int:
        with self._lock:
            return self._connections.get(session_id, 0)


manager = ConnectionManager()
