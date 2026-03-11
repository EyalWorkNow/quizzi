from __future__ import annotations

import json
import sys
from typing import Any

from behavior_engine import (
    build_class_dashboard,
    build_practice_set,
    build_student_dashboard,
    build_teacher_overview,
    outcome_for_answer,
)


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object")
    return payload


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command"}))
        return 1

    command = sys.argv[1]
    payload = read_payload()

    if command == "answer-outcome":
        result = outcome_for_answer(payload)
    elif command == "class-dashboard":
        result = build_class_dashboard(payload)
    elif command == "student-dashboard":
        result = build_student_dashboard(payload)
    elif command == "practice-set":
        result = build_practice_set(payload)
    elif command == "teacher-overview":
        result = build_teacher_overview(payload)
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
