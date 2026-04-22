from datetime import timezone


def event_envelope(session_id: str, seq: int, event_type: str, created_at, payload: dict) -> dict:
    timestamp = created_at
    if hasattr(created_at, "astimezone"):
        timestamp = created_at.astimezone(timezone.utc).isoformat()
    return {
        "seq": seq,
        "type": event_type,
        "session_id": session_id,
        "timestamp": timestamp,
        "payload": payload,
    }
