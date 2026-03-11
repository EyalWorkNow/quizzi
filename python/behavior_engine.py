from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from math import ceil, log, sqrt
from typing import Any


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def as_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, bool):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return False


def avg(values: list[float | int]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def stddev(values: list[float | int]) -> float:
    if len(values) <= 1:
        return 0.0
    mean = avg(values)
    variance = sum((float(value) - mean) ** 2 for value in values) / len(values)
    return sqrt(variance)


def percentile(values: list[float | int], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = clamp(quantile, 0.0, 1.0) * (len(ordered) - 1)
    lower_index = int(position)
    upper_index = min(len(ordered) - 1, lower_index + 1)
    weight = position - lower_index
    return ordered[lower_index] * (1.0 - weight) + ordered[upper_index] * weight


def pearson_correlation(values_x: list[float | int], values_y: list[float | int]) -> float:
    if len(values_x) != len(values_y) or len(values_x) <= 1:
        return 0.0
    mean_x = avg(values_x)
    mean_y = avg(values_y)
    numerator = sum((float(x) - mean_x) * (float(y) - mean_y) for x, y in zip(values_x, values_y))
    denominator_x = sqrt(sum((float(x) - mean_x) ** 2 for x in values_x))
    denominator_y = sqrt(sum((float(y) - mean_y) ** 2 for y in values_y))
    denominator = denominator_x * denominator_y
    if denominator == 0:
        return 0.0
    return clamp(numerator / denominator, -1.0, 1.0)


def pct(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return (numerator / denominator) * 100.0


def parse_string_list(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("[") and text.endswith("]"):
            import json

            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except json.JSONDecodeError:
                pass
        if "," in text:
            return [item.strip() for item in text.split(",") if item.strip()]
        return [text] if text else []
    return []


def parse_json_object(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        import json

        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def distribution_entropy(values: list[float | int]) -> float:
    numeric_values = [max(0.0, float(value)) for value in values if float(value) > 0]
    total = sum(numeric_values)
    if total <= 0:
        return 0.0
    entropy = 0.0
    for value in numeric_values:
        probability = value / total
        entropy -= probability * (0.0 if probability <= 0 else log(probability, 2))
    return entropy


def compute_attention_drag(
    focus_loss_count: float,
    idle_time_ms: float,
    blur_time_ms: float,
    longest_idle_streak_ms: float,
) -> float:
    return round(
        clamp(
            (focus_loss_count * 18.0)
            + (idle_time_ms / 220.0)
            + (blur_time_ms / 260.0)
            + (longest_idle_streak_ms / 300.0),
            0.0,
            100.0,
        ),
        1,
    )


def build_mastery_map(current_mastery: Any) -> dict[str, float]:
    if isinstance(current_mastery, dict):
        return {str(tag): as_float(score) for tag, score in current_mastery.items()}
    mastery_map: dict[str, float] = {}
    if isinstance(current_mastery, list):
        for entry in current_mastery:
            if not isinstance(entry, dict):
                continue
            tag = str(entry.get("tag", "")).strip()
            if tag:
                mastery_map[tag] = as_float(entry.get("score"))
    return mastery_map


def normalize_question(question: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(question)
    normalized["id"] = as_int(question.get("id"))
    normalized["prompt"] = str(question.get("prompt", "")).strip()
    normalized["correct_index"] = as_int(question.get("correct_index"))
    normalized["time_limit_seconds"] = max(5, as_int(question.get("time_limit_seconds"), 20))
    normalized["tags"] = parse_string_list(question.get("tags") or question.get("tags_json"))

    answers = question.get("answers")
    if not answers:
        answers = parse_string_list(question.get("answers_json"))
    normalized["answers"] = [str(answer) for answer in answers]
    return normalized


def normalize_answer(answer: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(answer)
    normalized["id"] = as_int(answer.get("id"))
    normalized["session_id"] = as_int(answer.get("session_id"))
    normalized["question_id"] = as_int(answer.get("question_id"))
    normalized["participant_id"] = as_int(answer.get("participant_id"))
    normalized["chosen_index"] = as_int(answer.get("chosen_index"))
    normalized["is_correct"] = as_bool(answer.get("is_correct"))
    normalized["response_ms"] = max(0, as_int(answer.get("response_ms")))
    normalized["score_awarded"] = as_int(answer.get("score_awarded"))
    return normalized


def normalize_log(log: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(log)
    normalized["id"] = as_int(log.get("id"))
    normalized["session_id"] = as_int(log.get("session_id"))
    normalized["question_id"] = as_int(log.get("question_id"))
    normalized["participant_id"] = as_int(log.get("participant_id"))
    normalized["tfi_ms"] = max(0, as_int(log.get("tfi_ms")))
    normalized["final_decision_buffer_ms"] = max(0, as_int(log.get("final_decision_buffer_ms")))
    normalized["total_swaps"] = max(0, as_int(log.get("total_swaps")))
    normalized["panic_swaps"] = max(0, as_int(log.get("panic_swaps")))
    normalized["focus_loss_count"] = max(0, as_int(log.get("focus_loss_count")))
    normalized["idle_time_ms"] = max(0, as_int(log.get("idle_time_ms")))
    normalized["blur_time_ms"] = max(0, as_int(log.get("blur_time_ms")))
    normalized["longest_idle_streak_ms"] = max(0, as_int(log.get("longest_idle_streak_ms")))
    normalized["pointer_activity_count"] = max(0, as_int(log.get("pointer_activity_count")))
    normalized["keyboard_activity_count"] = max(0, as_int(log.get("keyboard_activity_count")))
    normalized["touch_activity_count"] = max(0, as_int(log.get("touch_activity_count")))
    normalized["same_answer_reclicks"] = max(0, as_int(log.get("same_answer_reclicks")))
    normalized["option_dwell"] = {
        str(key): max(0.0, as_float(value))
        for key, value in parse_json_object(log.get("option_dwell") or log.get("option_dwell_json")).items()
    }
    normalized["hovered_options_count"] = sum(
        1 for value in normalized["option_dwell"].values() if as_float(value) > 0
    )
    normalized["hover_entropy"] = round(
        distribution_entropy(list(normalized["option_dwell"].values())),
        3,
    )
    normalized["answer_path"] = parse_answer_path(log.get("answer_path") or log.get("answer_path_json"))
    return normalized


def parse_answer_path(value: Any) -> list[dict[str, int]]:
    if not value:
        return []
    raw_items: list[Any] = []
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str):
        import json

        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                raw_items = parsed
        except json.JSONDecodeError:
            return []

    path: list[dict[str, int]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        timestamp = item.get("timestamp_ms", item.get("timestamp"))
        path.append(
            {
                "index": as_int(item.get("index"), -1),
                "timestamp": max(0, as_int(timestamp)),
            }
        )

    path = [item for item in path if item["index"] >= 0]
    path.sort(key=lambda item: item["timestamp"])
    return path


def normalize_answer_path_timestamps(path: list[dict[str, int]], response_ms: int) -> list[dict[str, int]]:
    if not path:
        return []
    timestamps = [item["timestamp"] for item in path]
    if not timestamps:
        return []

    first_timestamp = min(timestamps)
    epoch_like = first_timestamp > max(10000, response_ms * 4)
    normalized: list[dict[str, int]] = []
    for item in path:
        relative_timestamp = item["timestamp"] - first_timestamp if epoch_like else item["timestamp"]
        normalized.append(
            {
                "index": item["index"],
                "timestamp": max(0, min(response_ms, relative_timestamp)),
            }
        )
    normalized.sort(key=lambda item: item["timestamp"])
    return normalized


def classify_pace(response_ms: int, time_limit_seconds: int) -> str:
    ratio = response_ms / max(1000, time_limit_seconds * 1000)
    if ratio <= 0.28:
        return "rapid"
    if ratio <= 0.7:
        return "steady"
    return "extended"


def classify_commit(commit_window_ms: int) -> str:
    if commit_window_ms < 1200:
        return "last-moment"
    if commit_window_ms < 4500:
        return "active-checking"
    return "locked-early"


def summarize_decision_path(
    response_ms: int,
    time_limit_seconds: int,
    log: dict[str, Any] | None,
) -> dict[str, Any]:
    if not log:
        deadline_buffer_ms = max(0, (time_limit_seconds * 1000) - response_ms)
        return {
            "path": [],
            "distinct_options": 0,
            "revisit_count": 0,
            "flip_flops": 0,
            "commit_window_ms": 0,
            "deadline_buffer_ms": deadline_buffer_ms,
            "decision_volatility": 0.0,
            "pace_label": classify_pace(response_ms, time_limit_seconds),
            "commit_style": classify_commit(0),
        }

    path = normalize_answer_path_timestamps(log.get("answer_path", []), response_ms)
    distinct_options = len({item["index"] for item in path})
    seen_options: set[int] = set()
    revisit_count = 0
    for item in path:
        if item["index"] in seen_options:
            revisit_count += 1
        seen_options.add(item["index"])

    flip_flops = 0
    for index in range(2, len(path)):
        if path[index]["index"] == path[index - 2]["index"] != path[index - 1]["index"]:
            flip_flops += 1

    commit_window_ms = max(0, response_ms - path[-1]["timestamp"]) if path else 0
    deadline_buffer_ms = max(0, (time_limit_seconds * 1000) - response_ms)
    decision_volatility = round(
        clamp(
            (as_float(log.get("total_swaps")) * 15.0)
            + (revisit_count * 10.0)
            + (flip_flops * 14.0)
            + max(0, distinct_options - 2) * 7.0
            - (commit_window_ms / 500.0),
            0.0,
            100.0,
        ),
        1,
    )

    return {
        "path": path,
        "distinct_options": distinct_options,
        "revisit_count": revisit_count,
        "flip_flops": flip_flops,
        "commit_window_ms": commit_window_ms,
        "deadline_buffer_ms": deadline_buffer_ms,
        "decision_volatility": decision_volatility,
        "pace_label": classify_pace(response_ms, time_limit_seconds),
        "commit_style": classify_commit(commit_window_ms),
    }


def speed_factor(response_ms: int, time_limit_seconds: int) -> float:
    available_ms = max(1000, time_limit_seconds * 1000)
    return clamp(1.0 - (response_ms / available_ms), 0.0, 1.0)


def classify_stress(stress_index: float) -> str:
    if stress_index >= 70:
        return "high"
    if stress_index >= 40:
        return "medium"
    return "low"


def compute_stress_index(
    avg_tfi_ms: float,
    avg_swaps: float,
    total_panic_swaps: float,
    avg_focus_loss: float,
    answers_count: int,
) -> float:
    hesitation = clamp(avg_tfi_ms / 12000.0, 0.0, 1.0) * 40.0
    swaps = clamp(avg_swaps / 3.0, 0.0, 1.0) * 25.0
    panic_ratio = clamp(
        (total_panic_swaps / answers_count) if answers_count > 0 else 0.0, 0.0, 1.0
    ) * 20.0
    focus = clamp(avg_focus_loss / 1.5, 0.0, 1.0) * 15.0
    return round(hesitation + swaps + panic_ratio + focus, 1)


def build_question_recommendation(question_row: dict[str, Any]) -> str:
    if question_row["accuracy"] < 45:
        return "Review the concept and simplify distractors before reusing this item."
    if question_row["stress_index"] >= 65:
        return "Students reached the answer under pressure. Keep the concept, but tighten timing or wording."
    if question_row["avg_focus_loss"] >= 0.5:
        return "The question triggered visible disengagement. Consider splitting the prompt or shortening it."
    return "This item behaved normally and can stay in the rotation."


def compute_focus_score(total_focus_loss: float, avg_idle_time_ms: float) -> int:
    return round(clamp(100.0 - (total_focus_loss * 10.0) - (avg_idle_time_ms / 1500.0), 0.0, 100.0))


def compute_confidence_score(
    accuracy: float,
    avg_tfi_ms: float,
    avg_swaps: float,
    total_panic_swaps: float,
) -> int:
    confidence = 45.0 + (accuracy * 0.55)
    confidence -= min(avg_swaps * 8.0, 18.0)
    confidence -= min(total_panic_swaps * 6.0, 18.0)
    if avg_tfi_ms > 10000:
        confidence -= 8.0
    elif avg_tfi_ms < 1800 and accuracy < 55:
        confidence -= 10.0
    return round(clamp(confidence, 0.0, 100.0))


def compute_risk_score(
    accuracy: float,
    stress_index: float,
    focus_score: float,
    answers_count: int,
) -> float:
    mastery_gap = max(0.0, 68.0 - accuracy) * 1.05
    stress_pressure = stress_index * 0.55
    focus_drag = max(0.0, 72.0 - focus_score) * 0.65
    low_signal_penalty = max(0, 4 - answers_count) * 4.0
    return round(clamp(mastery_gap + stress_pressure + focus_drag + low_signal_penalty, 0.0, 100.0), 1)


def classify_risk(risk_score: float) -> str:
    if risk_score >= 70:
        return "high"
    if risk_score >= 45:
        return "medium"
    return "low"


def build_student_recommendation(
    accuracy: float,
    stress_index: float,
    focus_score: float,
    weak_tags: list[str],
) -> str:
    weak_text = ", ".join(tag.title() for tag in weak_tags[:2])
    if accuracy < 50 and weak_text:
        return f"Build a same-material follow-up focused on {weak_text} before the next live session."
    if stress_index >= 60:
        return "Reuse the same material with calmer pacing and fewer look-alike distractors."
    if focus_score < 60:
        return "Use a shorter, tighter follow-up game to keep attention anchored."
    if weak_text:
        return f"Target {weak_text} for reinforcement and then stretch back into mixed practice."
    return "This student is ready for a broader mixed review from the same pack."


def build_distribution(
    values: list[float],
    bands: list[tuple[str, float, float]],
) -> list[dict[str, Any]]:
    return [
        {
            "label": label,
            "count": sum(1 for value in values if minimum <= value <= maximum),
        }
        for label, minimum, maximum in bands
    ]


def build_stat_summary(values: list[float | int]) -> dict[str, Any]:
    numeric_values = [float(value) for value in values]
    return {
        "count": len(numeric_values),
        "mean": round(avg(numeric_values), 2),
        "median": round(percentile(numeric_values, 0.5), 2),
        "min": round(min(numeric_values), 2) if numeric_values else 0.0,
        "p25": round(percentile(numeric_values, 0.25), 2),
        "p75": round(percentile(numeric_values, 0.75), 2),
        "max": round(max(numeric_values), 2) if numeric_values else 0.0,
        "stddev": round(stddev(numeric_values), 2),
    }


def build_class_correlations(participant_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(participant_rows) <= 1:
        return []

    metric_map = {
        "accuracy": [row["accuracy"] for row in participant_rows],
        "stress_index": [row["stress_index"] for row in participant_rows],
        "focus_score": [row["focus_score"] for row in participant_rows],
        "confidence_score": [row["confidence_score"] for row in participant_rows],
        "avg_response_ms": [row["avg_response_ms"] for row in participant_rows],
        "total_score": [row["total_score"] for row in participant_rows],
        "avg_tfi_ms": [row["avg_tfi_ms"] for row in participant_rows],
        "avg_blur_time_ms": [row["avg_blur_time_ms"] for row in participant_rows],
        "attention_drag_index": [row["attention_drag_index"] for row in participant_rows],
        "avg_hover_entropy": [row["avg_hover_entropy"] for row in participant_rows],
    }

    pairs = [
        ("accuracy", "stress_index", "Accuracy vs Stress"),
        ("accuracy", "focus_score", "Accuracy vs Focus"),
        ("accuracy", "confidence_score", "Accuracy vs Confidence"),
        ("accuracy", "avg_response_ms", "Accuracy vs Response Time"),
        ("total_score", "stress_index", "Score vs Stress"),
        ("avg_tfi_ms", "confidence_score", "Think Time vs Confidence"),
        ("accuracy", "avg_blur_time_ms", "Accuracy vs Blur Time"),
        ("focus_score", "attention_drag_index", "Focus vs Attention Drag"),
        ("confidence_score", "avg_hover_entropy", "Confidence vs Option Exploration"),
    ]

    rows: list[dict[str, Any]] = []
    for left_key, right_key, label in pairs:
        value = round(pearson_correlation(metric_map[left_key], metric_map[right_key]), 3)
        rows.append(
            {
                "label": label,
                "left_metric": left_key,
                "right_metric": right_key,
                "value": value,
                "strength": (
                    "strong"
                    if abs(value) >= 0.65
                    else "medium"
                    if abs(value) >= 0.35
                    else "weak"
                ),
                "direction": "positive" if value > 0.1 else "negative" if value < -0.1 else "flat",
            }
        )
    rows.sort(key=lambda row: (-abs(row["value"]), row["label"]))
    return rows


def build_student_clusters(participant_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clusters: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"id": "", "label": "", "description": "", "count": 0, "students": []}
    )

    def register(cluster_id: str, label: str, description: str, row: dict[str, Any]) -> None:
        cluster = clusters[cluster_id]
        cluster["id"] = cluster_id
        cluster["label"] = label
        cluster["description"] = description
        cluster["count"] += 1
        cluster["students"].append(
            {
                "id": row["id"],
                "nickname": row["nickname"],
                "accuracy": row["accuracy"],
                "stress_index": row["stress_index"],
            }
        )

    for row in participant_rows:
        accuracy = row["accuracy"]
        stress = row["stress_index"]
        focus = row["focus_score"]
        if accuracy >= 80 and stress < 35:
            register(
                "stable-mastery",
                "Stable Mastery",
                "High accuracy with low pressure. These students can be stretched or used as peer anchors.",
                row,
            )
        elif accuracy >= 75 and stress >= 35:
            register(
                "accurate-under-pressure",
                "Accurate Under Pressure",
                "Conceptual mastery is there, but behavior suggests high internal load while solving.",
                row,
            )
        elif accuracy < 60 and stress >= 45:
            register(
                "pressure-collapse",
                "Pressure Collapse",
                "Low accuracy and high stress suggest overload, fragile confidence, or unclear item design.",
                row,
            )
        elif focus < 65:
            register(
                "focus-fragile",
                "Focus Fragile",
                "Performance is likely being dragged down by unstable attention more than content alone.",
                row,
            )
        else:
            register(
                "developing-middle",
                "Developing Middle",
                "These students are in the mixed middle: partially on track, but not yet behaviorally stable.",
                row,
            )

    rows = list(clusters.values())
    rows.sort(key=lambda row: (-row["count"], row["label"]))
    return rows


def build_class_outliers(
    participant_rows: list[dict[str, Any]],
    question_rows: list[dict[str, Any]],
    correlations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    outliers: list[dict[str, Any]] = []
    if participant_rows:
        highest_stress = max(participant_rows, key=lambda row: row["stress_index"])
        lowest_accuracy = min(participant_rows, key=lambda row: row["accuracy"])
        longest_response = max(participant_rows, key=lambda row: row["avg_response_ms"])
        most_focus_loss = max(participant_rows, key=lambda row: row["total_focus_loss"])

        outliers.append(
            {
                "type": "student",
                "title": "Highest stress student",
                "label": highest_stress["nickname"],
                "value": round(highest_stress["stress_index"], 1),
                "body": f"{highest_stress['nickname']} carried the strongest pressure signal in the room.",
            }
        )
        outliers.append(
            {
                "type": "student",
                "title": "Lowest accuracy student",
                "label": lowest_accuracy["nickname"],
                "value": round(lowest_accuracy["accuracy"], 1),
                "body": f"{lowest_accuracy['nickname']} had the lowest accuracy and should be reviewed first.",
            }
        )
        outliers.append(
            {
                "type": "student",
                "title": "Slowest average responder",
                "label": longest_response["nickname"],
                "value": round(longest_response["avg_response_ms"] / 1000.0, 1),
                "body": f"{longest_response['nickname']} took the longest average response time per item.",
            }
        )
        if most_focus_loss["total_focus_loss"] > 0:
            outliers.append(
                {
                    "type": "student",
                    "title": "Focus drift outlier",
                    "label": most_focus_loss["nickname"],
                    "value": most_focus_loss["total_focus_loss"],
                    "body": f"{most_focus_loss['nickname']} triggered the highest number of focus-loss events.",
                }
            )

    if question_rows:
        hardest_question = min(question_rows, key=lambda row: row["accuracy"])
        stress_question = max(question_rows, key=lambda row: row["stress_index"])
        outliers.append(
            {
                "type": "question",
                "title": "Most difficult item",
                "label": f"Question {hardest_question['index']}",
                "value": round(hardest_question["accuracy"], 1),
                "body": "This item had the lowest class accuracy and is the strongest reteach candidate.",
            }
        )
        outliers.append(
            {
                "type": "question",
                "title": "Highest pressure item",
                "label": f"Question {stress_question['index']}",
                "value": round(stress_question["stress_index"], 1),
                "body": "This item produced the strongest hesitation/focus pressure combination.",
            }
        )

    if correlations:
        strongest = correlations[0]
        outliers.append(
            {
                "type": "correlation",
                "title": "Strongest relationship",
                "label": strongest["label"],
                "value": strongest["value"],
                "body": f"This was the strongest class-level metric relationship observed in the session ({strongest['direction']}).",
            }
        )

    return outliers[:6]


def build_sequence_dynamics(question_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "question_index": row["index"],
            "accuracy": row["accuracy"],
            "stress_index": row["stress_index"],
            "avg_response_ms": row["avg_response_ms"],
            "avg_tfi_ms": row["avg_tfi"],
            "avg_swaps": row["avg_swaps"],
            "avg_focus_loss": row["avg_focus_loss"],
            "panic_swaps": row["total_panic_swaps"],
        }
        for row in sorted(question_rows, key=lambda row: row["index"])
    ]


def build_question_diagnostics(
    question_rows: list[dict[str, Any]],
    answers_by_question: dict[int, list[dict[str, Any]]],
    participant_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not participant_rows:
        return []

    sorted_participants = sorted(participant_rows, key=lambda row: (-row["total_score"], row["nickname"].lower()))
    quartile_size = max(1, len(sorted_participants) // 4)
    top_ids = {row["id"] for row in sorted_participants[:quartile_size]}
    bottom_ids = {row["id"] for row in sorted_participants[-quartile_size:]}

    diagnostics: list[dict[str, Any]] = []
    for row in question_rows:
        answers = answers_by_question.get(row["id"], [])
        top_answers = [answer for answer in answers if answer["participant_id"] in top_ids]
        bottom_answers = [answer for answer in answers if answer["participant_id"] in bottom_ids]
        top_accuracy = round(
            pct(sum(1 for answer in top_answers if answer["is_correct"]), len(top_answers)),
            1,
        ) if top_answers else 0.0
        bottom_accuracy = round(
            pct(sum(1 for answer in bottom_answers if answer["is_correct"]), len(bottom_answers)),
            1,
        ) if bottom_answers else 0.0
        diagnostics.append(
            {
                "question_id": row["id"],
                "question_index": row["index"],
                "question_prompt": row["prompt"],
                "tags": row["tags"],
                "accuracy": row["accuracy"],
                "difficulty_index": round(100.0 - row["accuracy"], 1),
                "stress_index": row["stress_index"],
                "discrimination_index": round(top_accuracy - bottom_accuracy, 1),
                "top_group_accuracy": top_accuracy,
                "bottom_group_accuracy": bottom_accuracy,
                "avg_response_ms": row["avg_response_ms"],
                "avg_swaps": row["avg_swaps"],
                "avg_blur_time_ms": row["avg_blur_time_ms"],
                "avg_interaction_intensity": row["avg_interaction_intensity"],
            }
        )
    diagnostics.sort(
        key=lambda row: (-row["difficulty_index"], -row["stress_index"], row["question_index"])
    )
    return diagnostics


def build_quartile_benchmarks(participant_rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not participant_rows:
        return {}

    sorted_rows = sorted(
        participant_rows,
        key=lambda row: (-row["accuracy"], -row["total_score"], row["nickname"].lower()),
    )
    quartile_size = max(1, len(sorted_rows) // 4)
    top_group = sorted_rows[:quartile_size]
    bottom_group = sorted_rows[-quartile_size:]
    middle_group = sorted_rows[quartile_size:-quartile_size] or sorted_rows[quartile_size:] or sorted_rows

    def summarize_group(group_id: str, label: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": group_id,
            "label": label,
            "count": len(rows),
            "accuracy": round(avg([row["accuracy"] for row in rows]), 1),
            "stress_index": round(avg([row["stress_index"] for row in rows]), 1),
            "focus_score": round(avg([row["focus_score"] for row in rows]), 1),
            "confidence_score": round(avg([row["confidence_score"] for row in rows]), 1),
            "avg_response_ms": round(avg([row["avg_response_ms"] for row in rows]), 1),
            "students": [row["nickname"] for row in rows[:5]],
        }

    return {
        "top_quartile": summarize_group("top_quartile", "Top quartile", top_group),
        "middle_band": summarize_group("middle_band", "Middle band", middle_group),
        "bottom_quartile": summarize_group("bottom_quartile", "Bottom quartile", bottom_group),
    }


def build_behavior_patterns(research_rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not research_rows:
        return {
            "pace_distribution": [],
            "commit_style_distribution": [],
            "accuracy_by_pace": [],
            "accuracy_by_commit_style": [],
            "decision_volatility": build_stat_summary([]),
            "commit_window_ms": build_stat_summary([]),
            "deadline_buffer_ms": build_stat_summary([]),
        }

    pace_counts: dict[str, int] = defaultdict(int)
    commit_counts: dict[str, int] = defaultdict(int)
    pace_accuracy: dict[str, list[int]] = defaultdict(list)
    commit_accuracy: dict[str, list[int]] = defaultdict(list)

    for row in research_rows:
        pace = str(row.get("pace_label", "unknown"))
        commit_style = str(row.get("commit_style", "unknown"))
        is_correct = as_int(row.get("is_correct"))
        pace_counts[pace] += 1
        commit_counts[commit_style] += 1
        pace_accuracy[pace].append(is_correct)
        commit_accuracy[commit_style].append(is_correct)

    return {
        "pace_distribution": [
            {"label": label, "count": count}
            for label, count in sorted(pace_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        "commit_style_distribution": [
            {"label": label, "count": count}
            for label, count in sorted(commit_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        "accuracy_by_pace": [
            {
                "label": label,
                "accuracy": round(pct(sum(values), len(values)), 1),
                "count": len(values),
            }
            for label, values in sorted(pace_accuracy.items(), key=lambda item: item[0])
        ],
        "accuracy_by_commit_style": [
            {
                "label": label,
                "accuracy": round(pct(sum(values), len(values)), 1),
                "count": len(values),
            }
            for label, values in sorted(commit_accuracy.items(), key=lambda item: item[0])
        ],
        "decision_volatility": build_stat_summary([row["decision_volatility"] for row in research_rows]),
        "commit_window_ms": build_stat_summary([row["commit_window_ms"] for row in research_rows]),
        "deadline_buffer_ms": build_stat_summary([row["deadline_buffer_ms"] for row in research_rows]),
        "attention_drag_index": build_stat_summary([row["attention_drag_index"] for row in research_rows]),
        "interaction_intensity": build_stat_summary([row["interaction_intensity"] for row in research_rows]),
        "hover_entropy": build_stat_summary([row["hover_entropy"] for row in research_rows]),
        "input_mix": [
            {"label": "Pointer", "count": sum(as_int(row.get("pointer_activity_count")) for row in research_rows)},
            {"label": "Keyboard", "count": sum(as_int(row.get("keyboard_activity_count")) for row in research_rows)},
            {"label": "Touch", "count": sum(as_int(row.get("touch_activity_count")) for row in research_rows)},
        ],
    }


def build_team_rows(
    session: dict[str, Any],
    participants: list[dict[str, Any]],
    participant_rows: list[dict[str, Any]],
    answers_by_participant: dict[int, list[dict[str, Any]]],
    question_map: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    teams: dict[int, dict[str, Any]] = defaultdict(
        lambda: {
            "team_id": 0,
            "team_name": "",
            "participant_ids": [],
            "members": [],
            "answers": [],
        }
    )
    participant_lookup = {row["id"]: row for row in participant_rows}
    team_game = str(session.get("game_type", "classic_quiz"))

    for participant in participants:
        team_id = as_int(participant.get("team_id"))
        if team_id <= 0:
            continue
        participant_id = as_int(participant.get("id"))
        entry = teams[team_id]
        entry["team_id"] = team_id
        entry["team_name"] = str(participant.get("team_name") or f"Team {team_id}")
        entry["participant_ids"].append(participant_id)
        if participant_id in participant_lookup:
            lookup = participant_lookup[participant_id]
            entry["members"].append(
                {
                    "id": participant_id,
                    "nickname": lookup["nickname"],
                    "accuracy": lookup["accuracy"],
                    "stress_index": lookup["stress_index"],
                }
            )
        entry["answers"].extend(answers_by_participant.get(participant_id, []))

    all_tags = sorted(
        {
            tag
            for question in question_map.values()
            for tag in question.get("tags", [])
        }
    )

    team_rows: list[dict[str, Any]] = []
    for team in teams.values():
        team_answers = team["answers"]
        if not team_answers:
            continue
        accuracy = round(
            pct(sum(1 for answer in team_answers if answer["is_correct"]), len(team_answers)),
            1,
        )
        base_score = sum(answer["score_awarded"] for answer in team_answers)
        avg_stress = round(
            avg([participant_lookup[pid]["stress_index"] for pid in team["participant_ids"] if pid in participant_lookup]),
            1,
        )
        avg_focus = round(
            avg([participant_lookup[pid]["focus_score"] for pid in team["participant_ids"] if pid in participant_lookup]),
            1,
        )
        avg_confidence = round(
            avg([participant_lookup[pid]["confidence_score"] for pid in team["participant_ids"] if pid in participant_lookup]),
            1,
        )

        by_question: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for answer in team_answers:
            by_question[answer["question_id"]].append(answer)

        consensus_values: list[float] = []
        correct_consensus_questions = 0
        correct_tags: set[str] = set()
        for question_id, answers in by_question.items():
            choice_counts: dict[int, int] = defaultdict(int)
            for answer in answers:
                choice_counts[answer["chosen_index"]] += 1
                if answer["is_correct"]:
                    for tag in question_map.get(question_id, {}).get("tags", []):
                        correct_tags.add(tag)
            top_choice = max(choice_counts.values()) if choice_counts else 0
            consensus = pct(top_choice, len(answers)) if answers else 0.0
            consensus_values.append(consensus)
            question = question_map.get(question_id) or {}
            correct_index = as_int(question.get("correct_index"), -1)
            if choice_counts and max(choice_counts, key=choice_counts.get) == correct_index:
                correct_consensus_questions += 1

        consensus_index = round(avg(consensus_values), 1)
        coverage_score = round(pct(len(correct_tags), len(all_tags)), 1) if all_tags else 0.0
        if team_game == "peer_pods":
            mode_bonus = round((consensus_index * 7.0) + (correct_consensus_questions * 280.0))
        elif team_game == "mastery_matrix":
            mode_bonus = round((coverage_score * 42.0) + (len(correct_tags) * 140.0))
        elif team_game == "team_relay":
            mode_bonus = round((accuracy * len(team["participant_ids"]) * 9.0) + (consensus_index * 3.0))
        else:
            mode_bonus = 0

        team_rows.append(
            {
                "team_id": team["team_id"],
                "team_name": team["team_name"],
                "student_count": len(team["participant_ids"]),
                "members": sorted(team["members"], key=lambda row: row["nickname"].lower()),
                "base_score": base_score,
                "mode_bonus": mode_bonus,
                "total_score": base_score + mode_bonus,
                "accuracy": accuracy,
                "consensus_index": consensus_index,
                "correct_consensus_questions": correct_consensus_questions,
                "coverage_score": coverage_score,
                "avg_stress": avg_stress,
                "avg_focus": avg_focus,
                "avg_confidence": avg_confidence,
            }
        )

    team_rows.sort(key=lambda row: (-row["total_score"], -row["accuracy"], row["team_name"].lower()))
    for index, row in enumerate(team_rows, start=1):
        row["rank"] = index
    return team_rows


def build_research_rows(
    participants: list[dict[str, Any]],
    answers: list[dict[str, Any]],
    question_map: dict[int, dict[str, Any]],
    question_order: dict[int, int],
    logs_by_pair: dict[tuple[int, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    participants_by_id = {as_int(participant.get("id")): dict(participant) for participant in participants}
    rows: list[dict[str, Any]] = []
    for answer in sorted(answers, key=lambda row: (row["participant_id"], question_order.get(row["question_id"], 0))):
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant = participants_by_id.get(answer["participant_id"], {})
        log = logs_by_pair.get((answer["participant_id"], answer["question_id"]))
        decision_path = summarize_decision_path(
            response_ms=answer["response_ms"],
            time_limit_seconds=question["time_limit_seconds"],
            log=log,
        )
        option_dwell = log.get("option_dwell") if log else {}
        interaction_count = (
            as_int(log.get("pointer_activity_count")) if log else 0
        ) + (
            as_int(log.get("keyboard_activity_count")) if log else 0
        ) + (
            as_int(log.get("touch_activity_count")) if log else 0
        )
        interaction_intensity = round(
            (interaction_count / max(1.0, answer["response_ms"] / 1000.0)),
            2,
        )
        attention_drag_index = compute_attention_drag(
            focus_loss_count=as_float(log.get("focus_loss_count")) if log else 0.0,
            idle_time_ms=as_float(log.get("idle_time_ms")) if log else 0.0,
            blur_time_ms=as_float(log.get("blur_time_ms")) if log else 0.0,
            longest_idle_streak_ms=as_float(log.get("longest_idle_streak_ms")) if log else 0.0,
        )
        rows.append(
            {
                "session_id": answer["session_id"],
                "participant_id": answer["participant_id"],
                "nickname": str(participant.get("nickname", f"Student {answer['participant_id']}")),
                "question_id": answer["question_id"],
                "question_index": question_order.get(answer["question_id"], 0),
                "question_prompt": question["prompt"],
                "tags": ", ".join(question["tags"]),
                "is_correct": 1 if answer["is_correct"] else 0,
                "chosen_index": answer["chosen_index"],
                "correct_index": question["correct_index"],
                "response_ms": answer["response_ms"],
                "score_awarded": answer["score_awarded"],
                "tfi_ms": as_int(log.get("tfi_ms")) if log else 0,
                "total_swaps": as_int(log.get("total_swaps")) if log else 0,
                "panic_swaps": as_int(log.get("panic_swaps")) if log else 0,
                "focus_loss_count": as_int(log.get("focus_loss_count")) if log else 0,
                "idle_time_ms": as_int(log.get("idle_time_ms")) if log else 0,
                "blur_time_ms": as_int(log.get("blur_time_ms")) if log else 0,
                "longest_idle_streak_ms": as_int(log.get("longest_idle_streak_ms")) if log else 0,
                "pointer_activity_count": as_int(log.get("pointer_activity_count")) if log else 0,
                "keyboard_activity_count": as_int(log.get("keyboard_activity_count")) if log else 0,
                "touch_activity_count": as_int(log.get("touch_activity_count")) if log else 0,
                "same_answer_reclicks": as_int(log.get("same_answer_reclicks")) if log else 0,
                "hovered_options_count": as_int(log.get("hovered_options_count")) if log else 0,
                "hover_entropy": round(as_float(log.get("hover_entropy")), 3) if log else 0.0,
                "interaction_count": interaction_count,
                "interaction_intensity": interaction_intensity,
                "attention_drag_index": attention_drag_index,
                "option_dwell_json": option_dwell,
                "commit_window_ms": decision_path["commit_window_ms"],
                "deadline_buffer_ms": decision_path["deadline_buffer_ms"],
                "decision_volatility": decision_path["decision_volatility"],
                "pace_label": decision_path["pace_label"],
                "commit_style": decision_path["commit_style"],
            }
        )
    return rows


def build_tag_rows_for_answers(
    answers: list[dict[str, Any]],
    question_map: dict[int, dict[str, Any]],
    logs_by_pair: dict[tuple[int, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    tag_aggregate: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "tag": "",
            "attempts": 0,
            "correct": 0,
            "response_values": [],
            "tfi_values": [],
            "swap_total": 0,
            "panic_total": 0,
            "focus_values": [],
        }
    )

    for answer in answers:
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant_log = logs_by_pair.get((answer["participant_id"], answer["question_id"]))
        for tag in question["tags"] or ["general"]:
            entry = tag_aggregate[tag]
            entry["tag"] = tag
            entry["attempts"] += 1
            entry["correct"] += 1 if answer["is_correct"] else 0
            entry["response_values"].append(answer["response_ms"])
            if participant_log:
                entry["tfi_values"].append(participant_log["tfi_ms"])
                entry["swap_total"] += participant_log["total_swaps"]
                entry["panic_total"] += participant_log["panic_swaps"]
                entry["focus_values"].append(participant_log["focus_loss_count"])

    rows: list[dict[str, Any]] = []
    for tag, entry in tag_aggregate.items():
        attempts = entry["attempts"]
        avg_tfi_ms = round(avg(entry["tfi_values"]), 1)
        avg_swaps = round(entry["swap_total"] / attempts, 2) if attempts else 0.0
        avg_focus_loss = round(avg(entry["focus_values"]), 2)
        score = round(pct(entry["correct"], attempts), 1)
        rows.append(
            {
                "tag": tag,
                "attempts": attempts,
                "correct": entry["correct"],
                "score": score,
                "accuracy": score,
                "avg_response_ms": round(avg(entry["response_values"]), 1),
                "avg_tfi": avg_tfi_ms,
                "avg_swaps": avg_swaps,
                "avg_focus_loss": avg_focus_loss,
                "total_panic_swaps": entry["panic_total"],
                "stress_index": compute_stress_index(
                    avg_tfi_ms=avg_tfi_ms,
                    avg_swaps=avg_swaps,
                    total_panic_swaps=entry["panic_total"],
                    avg_focus_loss=avg_focus_loss,
                    answers_count=attempts,
                ),
            }
        )

    rows.sort(key=lambda row: (row["score"], row["tag"]))
    return rows


def build_question_review_rows(
    answers: list[dict[str, Any]],
    question_map: dict[int, dict[str, Any]],
    question_order: dict[int, int],
    log_by_pair: dict[tuple[int, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for answer in sorted(answers, key=lambda row: (row["id"], row["question_id"])):
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant_log = log_by_pair.get((answer["participant_id"], answer["question_id"]))
        decision_path = summarize_decision_path(
            response_ms=answer["response_ms"],
            time_limit_seconds=question["time_limit_seconds"],
            log=participant_log,
        )
        stress_index = compute_stress_index(
            avg_tfi_ms=as_float(participant_log.get("tfi_ms")) if participant_log else 0.0,
            avg_swaps=as_float(participant_log.get("total_swaps")) if participant_log else 0.0,
            total_panic_swaps=as_int(participant_log.get("panic_swaps")) if participant_log else 0,
            avg_focus_loss=as_float(participant_log.get("focus_loss_count")) if participant_log else 0.0,
            answers_count=1,
        )

        if not answer["is_correct"]:
            status = "missed"
            recommendation = "Bring this exact concept back in the adaptive follow-up."
        elif stress_index >= 60 or (participant_log and as_int(participant_log.get("total_swaps")) >= 2):
            status = "shaky"
            recommendation = "The answer was correct, but confidence looked unstable. Revisit with calmer pacing."
        else:
            status = "solid"
            recommendation = "This concept looked stable in this session."

        rows.append(
            {
                "question_id": question["id"],
                "question_index": question_order.get(question["id"], 0),
                "prompt": question["prompt"],
                "tags": question["tags"],
                "is_correct": answer["is_correct"],
                "chosen_index": answer["chosen_index"],
                "correct_index": question["correct_index"],
                "response_ms": answer["response_ms"],
                "tfi_ms": as_int(participant_log.get("tfi_ms")) if participant_log else 0,
                "total_swaps": as_int(participant_log.get("total_swaps")) if participant_log else 0,
                "panic_swaps": as_int(participant_log.get("panic_swaps")) if participant_log else 0,
                "focus_loss_count": as_int(participant_log.get("focus_loss_count")) if participant_log else 0,
                "idle_time_ms": as_int(participant_log.get("idle_time_ms")) if participant_log else 0,
                "blur_time_ms": as_int(participant_log.get("blur_time_ms")) if participant_log else 0,
                "longest_idle_streak_ms": as_int(participant_log.get("longest_idle_streak_ms")) if participant_log else 0,
                "pointer_activity_count": as_int(participant_log.get("pointer_activity_count")) if participant_log else 0,
                "keyboard_activity_count": as_int(participant_log.get("keyboard_activity_count")) if participant_log else 0,
                "touch_activity_count": as_int(participant_log.get("touch_activity_count")) if participant_log else 0,
                "same_answer_reclicks": as_int(participant_log.get("same_answer_reclicks")) if participant_log else 0,
                "hover_entropy": round(as_float(participant_log.get("hover_entropy")), 3) if participant_log else 0.0,
                "attention_drag_index": compute_attention_drag(
                    focus_loss_count=as_float(participant_log.get("focus_loss_count")) if participant_log else 0.0,
                    idle_time_ms=as_float(participant_log.get("idle_time_ms")) if participant_log else 0.0,
                    blur_time_ms=as_float(participant_log.get("blur_time_ms")) if participant_log else 0.0,
                    longest_idle_streak_ms=as_float(participant_log.get("longest_idle_streak_ms")) if participant_log else 0.0,
                ),
                "stress_index": stress_index,
                "status": status,
                "recommendation": recommendation,
                "distinct_options": decision_path["distinct_options"],
                "revisit_count": decision_path["revisit_count"],
                "flip_flops": decision_path["flip_flops"],
                "commit_window_ms": decision_path["commit_window_ms"],
                "deadline_buffer_ms": decision_path["deadline_buffer_ms"],
                "decision_volatility": decision_path["decision_volatility"],
                "pace_label": decision_path["pace_label"],
                "commit_style": decision_path["commit_style"],
                "answer_path": decision_path["path"],
            }
        )

    rows.sort(
        key=lambda row: (
            0 if row["status"] == "missed" else 1 if row["status"] == "shaky" else 2,
            -row["stress_index"],
            row["question_index"],
        )
    )
    return rows


def build_behavior_signals(
    answers: list[dict[str, Any]],
    question_review: list[dict[str, Any]],
    focus_score: float,
) -> list[dict[str, Any]]:
    if not answers:
        return []

    response_ratios = [
        row["response_ms"] / max(1000, as_int(row["deadline_buffer_ms"]) + row["response_ms"])
        if (row["deadline_buffer_ms"] + row["response_ms"]) > 0
        else 0.0
        for row in question_review
    ]
    stress_values = [row["stress_index"] for row in question_review]
    volatility_values = [row["decision_volatility"] for row in question_review]
    commit_values = [row["commit_window_ms"] for row in question_review]

    misses = [index for index, answer in enumerate(answers) if not answer["is_correct"]]
    if misses:
        recovery_checks = []
        for miss_index in misses:
            if miss_index + 1 < len(answers):
                recovery_checks.append(1 if answers[miss_index + 1]["is_correct"] else 0)
        recovery_index = round(pct(sum(recovery_checks), len(recovery_checks)), 1) if recovery_checks else 0.0
    else:
        recovery_index = 100.0

    under_pressure_rows = [
        row for row in question_review if row["deadline_buffer_ms"] < 5000 or row["panic_swaps"] > 0
    ]
    under_pressure_accuracy = round(
        pct(sum(1 for row in under_pressure_rows if row["is_correct"]), len(under_pressure_rows)),
        1,
    ) if under_pressure_rows else round(pct(sum(1 for answer in answers if answer["is_correct"]), len(answers)), 1)

    consistency_index = round(
        clamp(
            100.0
            - (stddev(response_ratios) * 120.0)
            - (stddev(stress_values) * 0.8)
            - (avg(volatility_values) * 0.2),
            0.0,
            100.0,
        ),
        1,
    )
    decisiveness = round(
        clamp(
            100.0
            - (avg(volatility_values) * 0.45)
            - (avg([row["tfi_ms"] for row in question_review]) / 180.0)
            + (pct(sum(1 for answer in answers if answer["is_correct"]), len(answers)) * 0.18),
            0.0,
            100.0,
        ),
        1,
    )
    focus_resilience = round(clamp((focus_score * 0.75) + 25.0, 0.0, 100.0), 1)
    confidence_alignment = round(
        clamp(
            100.0 - abs(avg([100.0 - row["decision_volatility"] for row in question_review]) - pct(sum(1 for answer in answers if answer["is_correct"]), len(answers))),
            0.0,
            100.0,
        ),
        1,
    )
    attention_drag = round(
        clamp(100.0 - avg([row["attention_drag_index"] for row in question_review]), 0.0, 100.0),
        1,
    )
    exploration_control = round(
        clamp(
            100.0
            - (avg([row["hover_entropy"] for row in question_review]) * 18.0)
            - (avg([row["same_answer_reclicks"] for row in question_review]) * 8.0),
            0.0,
            100.0,
        ),
        1,
    )

    return [
        {
            "id": "decisiveness",
            "label": "Decisiveness",
            "score": decisiveness,
            "caption": "How quickly the student converges on an answer without oscillation.",
        },
        {
            "id": "focus_resilience",
            "label": "Focus Resilience",
            "score": focus_resilience,
            "caption": "How well attention holds under the pace of the quiz.",
        },
        {
            "id": "pressure_handling",
            "label": "Pressure Handling",
            "score": under_pressure_accuracy,
            "caption": "Accuracy when the answer landed near the deadline or with panic changes.",
        },
        {
            "id": "recovery_index",
            "label": "Recovery After Error",
            "score": recovery_index,
            "caption": "How often the student rebounds correctly after a miss.",
        },
        {
            "id": "consistency",
            "label": "Consistency",
            "score": consistency_index,
            "caption": "How stable the student's pace and stress profile stay across questions.",
        },
        {
            "id": "confidence_alignment",
            "label": "Confidence Alignment",
            "score": confidence_alignment,
            "caption": "How well behavior-backed confidence matches actual correctness.",
        },
        {
            "id": "attention_drag",
            "label": "Attention Stability",
            "score": attention_drag,
            "caption": "How little the student was pulled into blur, idle, and focus-loss drag.",
        },
        {
            "id": "exploration_control",
            "label": "Exploration Control",
            "score": exploration_control,
            "caption": "How controlled the option-scanning pattern stayed before the final lock-in.",
        },
    ]


def build_momentum_summary(question_review: list[dict[str, Any]]) -> dict[str, Any]:
    if not question_review:
        return {
            "direction": "flat",
            "headline": "No momentum pattern yet.",
            "body": "Play one more session to unlock pacing trends.",
        }

    midpoint = max(1, len(question_review) // 2)
    early = question_review[:midpoint]
    late = question_review[midpoint:]
    early_accuracy = pct(sum(1 for row in early if row["is_correct"]), len(early))
    late_accuracy = pct(sum(1 for row in late if row["is_correct"]), len(late))
    early_stress = avg([row["stress_index"] for row in early])
    late_stress = avg([row["stress_index"] for row in late]) if late else early_stress

    if late_accuracy - early_accuracy >= 15 and late_stress <= early_stress + 10:
        return {
            "direction": "up",
            "headline": "The student settled in as the session progressed.",
            "body": "Accuracy improved in the back half without a matching stress spike.",
        }
    if early_accuracy - late_accuracy >= 15 and late_stress > early_stress:
        return {
            "direction": "down",
            "headline": "The student faded under session pressure.",
            "body": "The second half showed lower accuracy and higher stress, suggesting fatigue or overload.",
        }
    return {
        "direction": "flat",
        "headline": "The student's pace stayed relatively stable.",
        "body": "No strong fatigue or recovery trend appeared across the session.",
    }


def build_session_segments(question_review: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not question_review:
        return []

    total = len(question_review)
    third = max(1, total // 3)
    slices = [
        ("Opening", question_review[:third]),
        ("Middle", question_review[third: third * 2] or question_review[:third]),
        ("Closing", question_review[third * 2:] or question_review[-third:]),
    ]
    segments: list[dict[str, Any]] = []
    for label, rows in slices:
        if not rows:
            continue
        segments.append(
            {
                "label": label,
                "accuracy": round(pct(sum(1 for row in rows if row["is_correct"]), len(rows)), 1),
                "avg_stress": round(avg([row["stress_index"] for row in rows]), 1),
                "avg_commit_window_ms": round(avg([row["commit_window_ms"] for row in rows]), 1),
            }
        )
    return segments


def outcome_for_answer(payload: dict[str, Any]) -> dict[str, Any]:
    mode = str(payload.get("mode", "session")).strip().lower() or "session"
    is_correct = as_bool(payload.get("is_correct"))
    response_ms = max(0, as_int(payload.get("response_ms")))
    time_limit_seconds = max(5, as_int(payload.get("time_limit_seconds"), 20))
    tags = parse_string_list(payload.get("tags"))
    mastery_map = build_mastery_map(payload.get("current_mastery"))
    computed_speed = speed_factor(response_ms, time_limit_seconds)

    score_awarded = 0
    if mode == "session" and is_correct:
        score_awarded = 1000 + round(computed_speed * 1000)

    if mode == "practice":
        correct_gain = 5.0 + (computed_speed * 5.0)
        incorrect_penalty = -5.0
    else:
        correct_gain = 10.0 + (computed_speed * 10.0)
        incorrect_penalty = -15.0

    mastery_updates: list[dict[str, Any]] = []
    for tag in tags:
        current_score = mastery_map.get(tag, 0.0)
        delta = correct_gain if is_correct else incorrect_penalty
        new_score = round(clamp(current_score + delta, 0.0, 100.0), 1)
        mastery_updates.append(
            {
                "tag": tag,
                "previous_score": round(current_score, 1),
                "delta": round(new_score - current_score, 1),
                "score": new_score,
            }
        )

    return {
        "mode": mode,
        "is_correct": is_correct,
        "speed_factor": round(computed_speed, 4),
        "score_awarded": score_awarded,
        "mastery_updates": mastery_updates,
    }


def build_class_dashboard(payload: dict[str, Any]) -> dict[str, Any]:
    session = payload.get("session") or {}
    pack = payload.get("pack") or {}
    participants = [dict(participant) for participant in payload.get("participants", [])]
    questions = [normalize_question(question) for question in payload.get("questions", [])]
    answers = [normalize_answer(answer) for answer in payload.get("answers", [])]
    logs = [normalize_log(log) for log in payload.get("behavior_logs", [])]

    question_map = {question["id"]: question for question in questions}
    question_order = {question["id"]: index + 1 for index, question in enumerate(questions)}
    answers_by_participant: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_question: dict[int, list[dict[str, Any]]] = defaultdict(list)
    logs_by_pair: dict[tuple[int, int], dict[str, Any]] = {}

    for answer in answers:
        answers_by_participant[answer["participant_id"]].append(answer)
        answers_by_question[answer["question_id"]].append(answer)

    for log in logs:
        logs_by_pair[(log["participant_id"], log["question_id"])] = log

    participant_rows: list[dict[str, Any]] = []
    for participant in participants:
        participant_id = as_int(participant.get("id"))
        participant_answers = answers_by_participant.get(participant_id, [])
        participant_logs = [
            logs_by_pair[(participant_id, answer["question_id"])]
            for answer in participant_answers
            if (participant_id, answer["question_id"]) in logs_by_pair
        ]
        total_score = sum(answer["score_awarded"] for answer in participant_answers)
        correct_answers = sum(1 for answer in participant_answers if answer["is_correct"])
        answers_count = len(participant_answers)
        accuracy = round(pct(correct_answers, len(participant_answers)), 1)
        avg_response_ms = round(avg([answer["response_ms"] for answer in participant_answers]), 1)
        avg_tfi_ms = round(avg([log["tfi_ms"] for log in participant_logs]), 1)
        avg_swaps = round(avg([log["total_swaps"] for log in participant_logs]), 2)
        total_swaps = sum(log["total_swaps"] for log in participant_logs)
        total_panic_swaps = sum(log["panic_swaps"] for log in participant_logs)
        total_focus_loss = sum(log["focus_loss_count"] for log in participant_logs)
        avg_focus_loss = round(avg([log["focus_loss_count"] for log in participant_logs]), 2)
        avg_idle_time_ms = round(avg([log["idle_time_ms"] for log in participant_logs]), 1)
        avg_blur_time_ms = round(avg([log["blur_time_ms"] for log in participant_logs]), 1)
        avg_longest_idle_streak_ms = round(avg([log["longest_idle_streak_ms"] for log in participant_logs]), 1)
        total_pointer_activity = sum(log["pointer_activity_count"] for log in participant_logs)
        total_keyboard_activity = sum(log["keyboard_activity_count"] for log in participant_logs)
        total_touch_activity = sum(log["touch_activity_count"] for log in participant_logs)
        total_same_answer_reclicks = sum(log["same_answer_reclicks"] for log in participant_logs)
        avg_hover_entropy = round(avg([log["hover_entropy"] for log in participant_logs]), 3)
        avg_interaction_intensity = round(
            avg(
                [
                    (
                        related_log["pointer_activity_count"]
                        + related_log["keyboard_activity_count"]
                        + related_log["touch_activity_count"]
                    )
                    / max(
                        1.0,
                        answer["response_ms"] / 1000.0,
                    )
                    for answer in participant_answers
                    for related_log in [logs_by_pair.get((participant_id, answer["question_id"]))]
                    if related_log
                ]
            ),
            2,
        )
        attention_drag_index = compute_attention_drag(
            focus_loss_count=total_focus_loss / max(1, answers_count),
            idle_time_ms=avg_idle_time_ms,
            blur_time_ms=avg_blur_time_ms,
            longest_idle_streak_ms=avg_longest_idle_streak_ms,
        )
        stress_index = compute_stress_index(
            avg_tfi_ms=avg_tfi_ms,
            avg_swaps=avg_swaps,
            total_panic_swaps=total_panic_swaps,
            avg_focus_loss=avg_focus_loss,
            answers_count=answers_count,
        )
        session_tag_rows = build_tag_rows_for_answers(
            participant_answers,
            question_map,
            logs_by_pair,
        )
        profile = build_student_profile(
            answers=participant_answers,
            logs=participant_logs,
            mastery_rows=[{"tag": row["tag"], "score": row["score"]} for row in session_tag_rows],
        )
        risk_score = compute_risk_score(
            accuracy=accuracy,
            stress_index=stress_index,
            focus_score=profile["focus_score"],
            answers_count=answers_count,
        )
        risk_level = classify_risk(risk_score)
        flags: list[str] = []
        if accuracy < 50:
            flags.append("Low accuracy")
        if stress_index >= 60:
            flags.append("High pressure")
        if total_focus_loss > 0:
            flags.append("Focus loss")
        if total_panic_swaps > 1:
            flags.append("Last-second changes")
        if avg_blur_time_ms > 1500:
            flags.append("Tab blur drag")
        if avg_longest_idle_streak_ms > 2500:
            flags.append("Long idle streaks")
        participant_rows.append(
            {
                "id": participant_id,
                "nickname": participant.get("nickname", f"Student {participant_id}"),
                "team_id": as_int(participant.get("team_id")),
                "team_name": str(participant.get("team_name") or ""),
                "total_score": total_score,
                "accuracy": accuracy,
                "answers_count": answers_count,
                "correct_answers": correct_answers,
                "avg_response_ms": avg_response_ms,
                "avg_tfi_ms": avg_tfi_ms,
                "avg_swaps": avg_swaps,
                "avg_focus_loss": avg_focus_loss,
                "avg_idle_time_ms": avg_idle_time_ms,
                "avg_blur_time_ms": avg_blur_time_ms,
                "avg_longest_idle_streak_ms": avg_longest_idle_streak_ms,
                "avg_hover_entropy": avg_hover_entropy,
                "avg_interaction_intensity": avg_interaction_intensity,
                "total_swaps": total_swaps,
                "total_panic_swaps": total_panic_swaps,
                "total_focus_loss": total_focus_loss,
                "total_pointer_activity": total_pointer_activity,
                "total_keyboard_activity": total_keyboard_activity,
                "total_touch_activity": total_touch_activity,
                "total_same_answer_reclicks": total_same_answer_reclicks,
                "attention_drag_index": attention_drag_index,
                "stress_index": stress_index,
                "stress_level": classify_stress(stress_index),
                "confidence_score": profile["confidence_score"],
                "focus_score": profile["focus_score"],
                "decision_style": profile["decision_style"],
                "headline": profile["headline"],
                "body": profile["body"],
                "weak_tags": profile["weak_tags"],
                "strong_tags": profile["strong_tags"],
                "risk_score": risk_score,
                "risk_level": risk_level,
                "flags": flags,
                "recommendation": build_student_recommendation(
                    accuracy=accuracy,
                    stress_index=stress_index,
                    focus_score=profile["focus_score"],
                    weak_tags=profile["weak_tags"],
                ),
            }
        )

    participant_rows.sort(
        key=lambda row: (-row["total_score"], -row["accuracy"], row["nickname"].lower())
    )
    for index, row in enumerate(participant_rows, start=1):
        row["rank"] = index

    question_rows: list[dict[str, Any]] = []
    for question in questions:
        question_answers = answers_by_question.get(question["id"], [])
        question_logs = [
            logs_by_pair[(answer["participant_id"], question["id"])]
            for answer in question_answers
            if (answer["participant_id"], question["id"]) in logs_by_pair
        ]

        correct_answers = sum(1 for answer in question_answers if answer["is_correct"])
        accuracy = round(pct(correct_answers, len(question_answers)), 1)
        avg_tfi_ms = round(avg([log["tfi_ms"] for log in question_logs]), 1)
        avg_swaps = round(avg([log["total_swaps"] for log in question_logs]), 2)
        total_panic_swaps = sum(log["panic_swaps"] for log in question_logs)
        avg_focus_loss = round(avg([log["focus_loss_count"] for log in question_logs]), 2)
        avg_response_ms = round(avg([answer["response_ms"] for answer in question_answers]), 1)
        avg_blur_time_ms = round(avg([log["blur_time_ms"] for log in question_logs]), 1)
        avg_interaction_intensity = round(
            avg(
                [
                    (
                        related_log["pointer_activity_count"]
                        + related_log["keyboard_activity_count"]
                        + related_log["touch_activity_count"]
                    )
                    / max(1.0, answer["response_ms"] / 1000.0)
                    for answer in question_answers
                    for related_log in [logs_by_pair.get((answer["participant_id"], question["id"]))]
                    if related_log
                ]
            ),
            2,
        )
        avg_hover_entropy = round(avg([log["hover_entropy"] for log in question_logs]), 3)
        stress_index = compute_stress_index(
            avg_tfi_ms=avg_tfi_ms,
            avg_swaps=avg_swaps,
            total_panic_swaps=total_panic_swaps,
            avg_focus_loss=avg_focus_loss,
            answers_count=len(question_answers),
        )
        question_row = {
            "id": question["id"],
            "index": question_order.get(question["id"], 0),
            "prompt": question["prompt"],
            "accuracy": accuracy,
            "answers_count": len(question_answers),
            "correct_answers": correct_answers,
            "avg_tfi": avg_tfi_ms,
            "avg_swaps": avg_swaps,
            "avg_focus_loss": avg_focus_loss,
            "avg_response_ms": avg_response_ms,
            "avg_blur_time_ms": avg_blur_time_ms,
            "avg_interaction_intensity": avg_interaction_intensity,
            "avg_hover_entropy": avg_hover_entropy,
            "total_panic_swaps": total_panic_swaps,
            "stress_index": stress_index,
            "stress_level": classify_stress(stress_index),
            "tags": question["tags"],
            "missed_by_count": len(question_answers) - correct_answers,
        }
        question_row["recommendation"] = build_question_recommendation(question_row)
        question_rows.append(question_row)

    tag_aggregate: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "tag": "",
            "attempts": 0,
            "correct": 0,
            "participants": set(),
            "response_values": [],
            "tfi_values": [],
            "swap_total": 0,
            "panic_total": 0,
            "focus_values": [],
        }
    )
    for answer in answers:
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        question_log = logs_by_pair.get((answer["participant_id"], answer["question_id"]))
        for tag in question["tags"] or ["general"]:
            entry = tag_aggregate[tag]
            entry["tag"] = tag
            entry["attempts"] += 1
            entry["correct"] += 1 if answer["is_correct"] else 0
            entry["participants"].add(answer["participant_id"])
            entry["response_values"].append(answer["response_ms"])
            if question_log:
                entry["tfi_values"].append(question_log["tfi_ms"])
                entry["swap_total"] += question_log["total_swaps"]
                entry["panic_total"] += question_log["panic_swaps"]
                entry["focus_values"].append(question_log["focus_loss_count"])

    tag_summary: list[dict[str, Any]] = []
    for tag, entry in tag_aggregate.items():
        attempts = entry["attempts"]
        avg_tfi_ms = round(avg(entry["tfi_values"]), 1)
        avg_swaps = round(entry["swap_total"] / attempts, 2) if attempts else 0.0
        avg_focus_loss = round(avg(entry["focus_values"]), 2)
        accuracy = round(pct(entry["correct"], attempts), 1)
        stress_value = compute_stress_index(
            avg_tfi_ms=avg_tfi_ms,
            avg_swaps=avg_swaps,
            total_panic_swaps=entry["panic_total"],
            avg_focus_loss=avg_focus_loss,
            answers_count=attempts,
        )
        tag_summary.append(
            {
                "tag": tag,
                "attempts": attempts,
                "accuracy": accuracy,
                "avg_response_ms": round(avg(entry["response_values"]), 1),
                "avg_tfi": avg_tfi_ms,
                "avg_swaps": avg_swaps,
                "avg_focus_loss": avg_focus_loss,
                "total_panic_swaps": entry["panic_total"],
                "students_count": len(entry["participants"]),
                "stress_index": stress_value,
                "stress_level": classify_stress(stress_value),
            }
        )
    tag_summary.sort(key=lambda row: (row["accuracy"], -row["attempts"], row["tag"]))

    total_answers = len(answers)
    total_correct = sum(1 for answer in answers if answer["is_correct"])
    overall_accuracy = round(pct(total_correct, total_answers), 1)
    participant_count = len(participants)
    question_count = len(questions)
    completion_rate = round(
        pct(total_answers, participant_count * question_count) if participant_count and question_count else 0.0,
        1,
    )
    stress_index = round(avg([row["stress_index"] for row in question_rows]), 1)
    total_focus_loss = sum(log["focus_loss_count"] for log in logs)
    total_panic_swaps = sum(log["panic_swaps"] for log in logs)
    high_risk_count = sum(1 for row in participant_rows if row["risk_level"] == "high")
    medium_risk_count = sum(1 for row in participant_rows if row["risk_level"] == "medium")
    focus_watch_count = sum(1 for row in participant_rows if row["total_focus_loss"] > 0)

    alerts: list[dict[str, Any]] = []
    toughest_question = min(question_rows, key=lambda row: row["accuracy"], default=None)
    if toughest_question and toughest_question["accuracy"] < 55:
        alerts.append(
            {
                "type": "confusion",
                "severity": "high" if toughest_question["accuracy"] < 40 else "medium",
                "title": "High confusion detected",
                "body": (
                    f"Question {question_order.get(toughest_question['id'], 0)} landed at "
                    f"{toughest_question['accuracy']:.1f}% accuracy. Review wording or reteach the concept."
                ),
                "question_id": toughest_question["id"],
            }
        )

    highest_panic = max(question_rows, key=lambda row: row["total_panic_swaps"], default=None)
    panic_threshold = max(2, ceil(participant_count * 0.25))
    if highest_panic and highest_panic["total_panic_swaps"] >= panic_threshold:
        alerts.append(
            {
                "type": "panic",
                "severity": "high",
                "title": "Last-second switching spike",
                "body": (
                    f"Question {question_order.get(highest_panic['id'], 0)} triggered "
                    f"{highest_panic['total_panic_swaps']} panic swaps. Distractors may be too similar."
                ),
                "question_id": highest_panic["id"],
            }
        )

    average_focus_loss = avg([row["avg_focus_loss"] for row in question_rows])
    if average_focus_loss >= 0.5:
        alerts.append(
            {
                "type": "focus",
                "severity": "medium",
                "title": "Focus instability in session",
                "body": "Students switched away from the quiz tab more often than expected. Monitor for disengagement or outside help.",
            }
        )

    if high_risk_count > 0:
        alerts.append(
            {
                "type": "student-risk",
                "severity": "high" if high_risk_count > 1 else "medium",
                "title": "Students need targeted follow-up",
                "body": f"{high_risk_count} student(s) show a combined low-mastery and high-pressure pattern from this session.",
            }
        )

    if overall_accuracy < 55:
        alerts.append(
            {
                "type": "mastery",
                "severity": "medium",
                "title": "Low class mastery",
                "body": f"Overall accuracy finished at {overall_accuracy:.1f}%. Queue an adaptive follow-up practice set.",
            }
        )

    if completion_rate < 85 and participant_count and question_count:
        alerts.append(
            {
                "type": "completion",
                "severity": "low",
                "title": "Not all responses were captured",
                "body": f"Completion rate reached only {completion_rate:.1f}%. Check pacing or connection issues.",
            }
        )

    if overall_accuracy >= 80 and stress_index < 35:
        headline = "Strong mastery with low friction"
        summary = "The class answered confidently and with stable decision patterns."
    elif overall_accuracy >= 60:
        headline = "Mixed mastery, review a few pressure points"
        summary = "Most students are on track, but a small set of questions produced hesitation."
    else:
        headline = "Conceptual reset recommended"
        summary = "Accuracy and behavior signals both indicate the class needs a guided recap before the next assessment."

    accuracy_distribution = build_distribution(
        [row["accuracy"] for row in participant_rows],
        [
            ("0-39%", 0.0, 39.9),
            ("40-59%", 40.0, 59.9),
            ("60-79%", 60.0, 79.9),
            ("80-100%", 80.0, 100.0),
        ],
    )
    stress_distribution = build_distribution(
        [row["stress_index"] for row in participant_rows],
        [
            ("Low", 0.0, 39.9),
            ("Medium", 40.0, 69.9),
            ("High", 70.0, 100.0),
        ],
    )
    risk_distribution = [
        {"label": "Low", "count": sum(1 for row in participant_rows if row["risk_level"] == "low")},
        {"label": "Medium", "count": medium_risk_count},
        {"label": "High", "count": high_risk_count},
    ]
    team_rows = build_team_rows(
        session=session,
        participants=participants,
        participant_rows=participant_rows,
        answers_by_participant=answers_by_participant,
        question_map=question_map,
    )

    research_rows = build_research_rows(
        participants=participants,
        answers=answers,
        question_map=question_map,
        question_order=question_order,
        logs_by_pair=logs_by_pair,
    )
    correlations = build_class_correlations(participant_rows)
    student_clusters = build_student_clusters(participant_rows)
    question_diagnostics = build_question_diagnostics(
        question_rows=question_rows,
        answers_by_question=answers_by_question,
        participant_rows=participant_rows,
    )
    research = {
        "descriptive_stats": [
            {
                "id": "accuracy",
                "label": "Student accuracy",
                "unit": "%",
                "summary": build_stat_summary([row["accuracy"] for row in participant_rows]),
            },
            {
                "id": "stress_index",
                "label": "Student stress index",
                "unit": "%",
                "summary": build_stat_summary([row["stress_index"] for row in participant_rows]),
            },
            {
                "id": "focus_score",
                "label": "Student focus score",
                "unit": "pts",
                "summary": build_stat_summary([row["focus_score"] for row in participant_rows]),
            },
            {
                "id": "confidence_score",
                "label": "Student confidence",
                "unit": "pts",
                "summary": build_stat_summary([row["confidence_score"] for row in participant_rows]),
            },
            {
                "id": "avg_response_ms",
                "label": "Response time",
                "unit": "ms",
                "summary": build_stat_summary([row["avg_response_ms"] for row in participant_rows]),
            },
            {
                "id": "avg_tfi_ms",
                "label": "Think-first interval",
                "unit": "ms",
                "summary": build_stat_summary([row["avg_tfi_ms"] for row in participant_rows]),
            },
            {
                "id": "decision_volatility",
                "label": "Decision volatility",
                "unit": "pts",
                "summary": build_stat_summary([row["decision_volatility"] for row in research_rows]),
            },
            {
                "id": "attention_drag_index",
                "label": "Attention drag",
                "unit": "pts",
                "summary": build_stat_summary([row["attention_drag_index"] for row in research_rows]),
            },
            {
                "id": "interaction_intensity",
                "label": "Interaction intensity",
                "unit": "events/s",
                "summary": build_stat_summary([row["interaction_intensity"] for row in research_rows]),
            },
            {
                "id": "hover_entropy",
                "label": "Option exploration entropy",
                "unit": "bits",
                "summary": build_stat_summary([row["hover_entropy"] for row in research_rows]),
            },
        ],
        "correlations": correlations,
        "clusters": student_clusters,
        "outliers": build_class_outliers(
            participant_rows=participant_rows,
            question_rows=question_rows,
            correlations=correlations,
        ),
        "sequence_dynamics": build_sequence_dynamics(question_rows),
        "question_diagnostics": question_diagnostics,
        "quartile_benchmarks": build_quartile_benchmarks(participant_rows),
        "behavior_patterns": build_behavior_patterns(research_rows),
    }

    return {
        "session": {
            "id": as_int(session.get("id")),
            "pin": str(session.get("pin", "")),
            "status": str(session.get("status", "LOBBY")),
            "quiz_pack_id": as_int(session.get("quiz_pack_id")),
            "game_type": str(session.get("game_type", "classic_quiz")),
            "team_count": as_int(session.get("team_count")),
            "pack_title": str(pack.get("title") or f"Pack {as_int(session.get('quiz_pack_id'))}"),
            "question_count": question_count,
        },
        "participants": participant_rows,
        "questions": question_rows,
        "tagSummary": tag_summary,
        "summary": {
            "session_id": as_int(session.get("id")),
            "overall_accuracy": overall_accuracy,
            "participant_count": participant_count,
            "question_count": question_count,
            "completion_rate": completion_rate,
            "stress_index": stress_index,
            "total_answers": total_answers,
            "total_focus_loss": total_focus_loss,
            "total_panic_swaps": total_panic_swaps,
            "high_risk_students": high_risk_count,
            "medium_risk_students": medium_risk_count,
            "focus_watch_students": focus_watch_count,
            "team_count": len(team_rows),
            "headline": headline,
            "summary": summary,
            "toughest_question_id": toughest_question["id"] if toughest_question else None,
            "top_gap_tag": tag_summary[0]["tag"] if tag_summary else None,
        },
        "metrics": [
            {
                "question_id": row["id"],
                "question_index": row["index"],
                "avg_tfi": row["avg_tfi"],
                "avg_swaps": row["avg_swaps"],
                "total_panic_swaps": row["total_panic_swaps"],
                "avg_focus_loss": row["avg_focus_loss"],
                "avg_blur_time_ms": row["avg_blur_time_ms"],
                "avg_interaction_intensity": row["avg_interaction_intensity"],
                "avg_hover_entropy": row["avg_hover_entropy"],
                "answers_count": row["answers_count"],
                "stress_index": row["stress_index"],
                "stress_level": row["stress_level"],
            }
            for row in question_rows
        ],
        "distributions": {
            "accuracy": accuracy_distribution,
            "stress": stress_distribution,
            "risk": risk_distribution,
        },
        "research": research,
        "researchRows": research_rows,
        "studentSpotlight": {
            "top_performers": participant_rows[:3],
            "attention_needed": sorted(
                participant_rows,
                key=lambda row: (-row["risk_score"], row["nickname"].lower()),
            )[:5],
        },
        "teams": team_rows,
        "alerts": alerts,
    }


def build_student_profile(
    answers: list[dict[str, Any]],
    logs: list[dict[str, Any]],
    mastery_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    if not answers and not logs:
        weak_tags = sorted(mastery_rows, key=lambda row: row["score"])[:3]
        strong_tags = sorted(mastery_rows, key=lambda row: row["score"], reverse=True)[:3]
        return {
            "confidence_score": 0,
            "focus_score": 0,
            "decision_style": "Not enough data yet",
            "headline": "Play one session to unlock your profile.",
            "body": "Once you answer real questions, the engine will map confidence, focus and pacing patterns.",
            "weak_tags": [row["tag"] for row in weak_tags],
            "strong_tags": [row["tag"] for row in strong_tags],
        }

    total_swaps = sum(log["total_swaps"] for log in logs)
    total_panic_swaps = sum(log["panic_swaps"] for log in logs)
    total_focus_loss = sum(log["focus_loss_count"] for log in logs)
    avg_tfi_ms = avg([log["tfi_ms"] for log in logs])
    avg_idle_time_ms = avg([log["idle_time_ms"] for log in logs])
    avg_blur_time_ms = avg([log["blur_time_ms"] for log in logs])
    accuracy = pct(sum(1 for answer in answers if answer["is_correct"]), len(answers))

    confidence = 100.0
    confidence -= min(total_swaps * 3.0, 18.0)
    confidence -= min(total_panic_swaps * 7.0, 21.0)
    confidence -= min(total_focus_loss * 5.0, 20.0)
    confidence -= min(avg_blur_time_ms / 550.0, 12.0)
    if avg_tfi_ms > 10000:
        confidence -= 10.0
    if avg_tfi_ms < 1500 and accuracy < 55:
        confidence -= 15.0
    if accuracy > 80 and total_swaps <= len(answers):
        confidence += 5.0
    confidence = round(clamp(confidence, 0.0, 100.0))

    focus_score = round(
        clamp(
            100.0
            - (total_focus_loss * 10.0)
            - (avg_idle_time_ms / 1500.0)
            - (avg_blur_time_ms / 260.0),
            0.0,
            100.0,
        )
    )

    if avg_tfi_ms > 9000 and total_swaps > max(2, len(answers)):
        decision_style = "Careful re-checker"
        headline = "You think before you commit."
        body = "Your answers show deliberate thinking, but the extra re-checking is costing fluency. Aim to lock sooner when you already know the concept."
    elif avg_tfi_ms < 1500 and accuracy < 55:
        decision_style = "Fast guesser"
        headline = "You move fast, sometimes too fast."
        body = "Your first click often arrives before the reasoning is settled. Pause for one more pass before locking."
    elif confidence >= 80:
        decision_style = "Decisive solver"
        headline = "Your decisions look stable."
        body = "You answer with high confidence and low friction. Keep that rhythm and push on weaker topics."
    else:
        decision_style = "Balanced solver"
        headline = "Your pace is mostly balanced."
        body = "You are close to a steady pattern. Reducing answer swaps will improve both confidence and speed."

    weak_tags = sorted(mastery_rows, key=lambda row: row["score"])[:3]
    strong_tags = sorted(mastery_rows, key=lambda row: row["score"], reverse=True)[:3]

    return {
        "confidence_score": confidence,
        "focus_score": focus_score,
        "decision_style": decision_style,
        "headline": headline,
        "body": body,
        "weak_tags": [row["tag"] for row in weak_tags],
        "strong_tags": [row["tag"] for row in strong_tags],
    }


def build_student_dashboard(payload: dict[str, Any]) -> dict[str, Any]:
    nickname = str(payload.get("nickname", "")).strip()
    mastery_rows = [
        {"tag": str(entry.get("tag", "")).strip(), "score": round(as_float(entry.get("score")), 1)}
        for entry in payload.get("mastery", [])
        if str(entry.get("tag", "")).strip()
    ]
    answers = [normalize_answer(answer) for answer in payload.get("answers", [])]
    questions = [normalize_question(question) for question in payload.get("questions", [])]
    logs = [normalize_log(log) for log in payload.get("behavior_logs", [])]
    sessions = {as_int(session.get("id")): dict(session) for session in payload.get("sessions", [])}
    packs = {as_int(pack.get("id")): dict(pack) for pack in payload.get("packs", [])}
    practice_attempts = [
        {
            "question_id": as_int(attempt.get("question_id")),
            "is_correct": as_bool(attempt.get("is_correct")),
            "response_ms": max(0, as_int(attempt.get("response_ms"))),
        }
        for attempt in payload.get("practice_attempts", [])
    ]

    question_map = {question["id"]: question for question in questions}
    question_order = {question["id"]: index + 1 for index, question in enumerate(questions)}
    log_by_pair = {(log["participant_id"], log["question_id"]): log for log in logs}
    logs_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for answer in answers:
        answers_by_session[answer["session_id"]].append(answer)
    for log in logs:
        logs_by_session[log["session_id"]].append(log)

    stats = {
        "nickname": nickname,
        "total_score": sum(answer["score_awarded"] for answer in answers),
        "accuracy": round(pct(sum(1 for answer in answers if answer["is_correct"]), len(answers)), 1),
        "total_answers": len(answers),
        "avg_response_ms": round(avg([answer["response_ms"] for answer in answers]), 1),
        "practice_attempts": len(practice_attempts),
    }

    aggregates = {
        "avg_tfi": round(avg([log["tfi_ms"] for log in logs]), 1),
        "avg_buffer": round(avg([log["final_decision_buffer_ms"] for log in logs]), 1),
        "total_swaps": sum(log["total_swaps"] for log in logs),
        "total_panic_swaps": sum(log["panic_swaps"] for log in logs),
        "total_focus_loss": sum(log["focus_loss_count"] for log in logs),
        "avg_idle_time_ms": round(avg([log["idle_time_ms"] for log in logs]), 1),
        "avg_blur_time_ms": round(avg([log["blur_time_ms"] for log in logs]), 1),
        "avg_longest_idle_streak_ms": round(avg([log["longest_idle_streak_ms"] for log in logs]), 1),
        "pointer_activity_total": sum(log["pointer_activity_count"] for log in logs),
        "keyboard_activity_total": sum(log["keyboard_activity_count"] for log in logs),
        "touch_activity_total": sum(log["touch_activity_count"] for log in logs),
        "same_answer_reclicks": sum(log["same_answer_reclicks"] for log in logs),
        "avg_hover_entropy": round(avg([log["hover_entropy"] for log in logs]), 3),
    }

    tag_aggregate: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"tag": "", "attempts": 0, "correct": 0, "score_sum": 0, "tfi_values": [], "swap_total": 0}
    )
    for answer in answers:
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant_log = log_by_pair.get((answer["participant_id"], answer["question_id"]))
        for tag in question["tags"] or ["general"]:
            entry = tag_aggregate[tag]
            entry["tag"] = tag
            entry["attempts"] += 1
            entry["correct"] += 1 if answer["is_correct"] else 0
            entry["score_sum"] += answer["score_awarded"]
            if participant_log:
                entry["tfi_values"].append(participant_log["tfi_ms"])
                entry["swap_total"] += participant_log["total_swaps"]

    tag_performance: list[dict[str, Any]] = []
    for tag, entry in tag_aggregate.items():
        tag_performance.append(
            {
                "tag": tag,
                "attempts": entry["attempts"],
                "accuracy": round(pct(entry["correct"], entry["attempts"]), 1),
                "avg_score": round(entry["score_sum"] / entry["attempts"], 1) if entry["attempts"] else 0.0,
                "avg_tfi": round(avg(entry["tfi_values"]), 1),
                "total_swaps": entry["swap_total"],
            }
        )
    tag_performance.sort(key=lambda entry: (entry["accuracy"], entry["tag"]))

    mastery_rows.sort(key=lambda row: (-row["score"], row["tag"]))
    profile = build_student_profile(answers=answers, logs=logs, mastery_rows=mastery_rows)
    session_stress = compute_stress_index(
        avg_tfi_ms=aggregates["avg_tfi"],
        avg_swaps=round(aggregates["total_swaps"] / max(1, stats["total_answers"]), 2),
        total_panic_swaps=aggregates["total_panic_swaps"],
        avg_focus_loss=round(aggregates["total_focus_loss"] / max(1, stats["total_answers"]), 2),
        answers_count=stats["total_answers"],
    )
    risk_score = compute_risk_score(
        accuracy=stats["accuracy"],
        stress_index=session_stress,
        focus_score=profile["focus_score"],
        answers_count=stats["total_answers"],
    )
    risk_level = classify_risk(risk_score)

    question_review = build_question_review_rows(
        answers=answers,
        question_map=question_map,
        question_order=question_order,
        log_by_pair=log_by_pair,
    )
    behavior_signals = build_behavior_signals(
        answers=answers,
        question_review=question_review,
        focus_score=profile["focus_score"],
    )
    momentum = build_momentum_summary(question_review)
    session_segments = build_session_segments(question_review)

    highlights: list[dict[str, str]] = []
    if profile["strong_tags"]:
        highlights.append(
            {
                "title": "Strongest topics",
                "body": ", ".join(profile["strong_tags"][:2]).title() + " are currently your most stable areas.",
            }
        )
    if profile["weak_tags"]:
        highlights.append(
            {
                "title": "Best next practice target",
                "body": ", ".join(profile["weak_tags"][:2]).title() + " should be your next review block.",
            }
        )
    if aggregates["total_focus_loss"] > 0:
        highlights.append(
            {
                "title": "Focus note",
                "body": "Tab switches were detected during play. Keeping one window open will likely raise your score.",
            }
        )

    recommendations: list[dict[str, str]] = []
    if profile["weak_tags"]:
        recommendations.append(
            {
                "title": "Weakest concept cluster",
                "body": "Start the next game with " + ", ".join(tag.title() for tag in profile["weak_tags"][:2]) + ".",
            }
        )
    if risk_level != "low":
        recommendations.append(
            {
                "title": "Confidence and pacing",
                "body": build_student_recommendation(
                    accuracy=stats["accuracy"],
                    stress_index=session_stress,
                    focus_score=profile["focus_score"],
                    weak_tags=profile["weak_tags"],
                ),
            }
        )
    if any(item["status"] == "shaky" for item in question_review):
        recommendations.append(
            {
                "title": "Stabilize correct-but-fragile answers",
                "body": "At least one answer was correct under pressure. Repeat those items before moving to new material.",
            }
        )

    adaptive_targets = {
        "focus_tags": profile["weak_tags"] or [entry["tag"] for entry in tag_performance[:3]],
        "priority_question_ids": [
            row["question_id"]
            for row in question_review
            if row["status"] in {"missed", "shaky"}
        ][:6],
    }

    practice_plan = {
        "headline": "Adaptive practice should target your weakest tags.",
        "body": (
            "Next session should revisit "
            + ", ".join(adaptive_targets["focus_tags"][:3]).title()
            + "."
            if adaptive_targets["focus_tags"]
            else "You have no clear weak tag yet, so mixed practice is the right next step."
        ),
        "focus_tags": adaptive_targets["focus_tags"],
    }

    session_history: list[dict[str, Any]] = []
    for session_id, session_answers in answers_by_session.items():
      session_logs = logs_by_session.get(session_id, [])
      session_log_by_pair = {(log["participant_id"], log["question_id"]): log for log in session_logs}
      session_review = build_question_review_rows(
          answers=session_answers,
          question_map=question_map,
          question_order=question_order,
          log_by_pair=session_log_by_pair,
      )
      related_session = sessions.get(session_id, {})
      pack = packs.get(as_int(related_session.get("quiz_pack_id")), {})
      session_history.append(
          {
              "session_id": session_id,
              "pack_title": str(pack.get("title") or f"Pack {as_int(related_session.get('quiz_pack_id'))}"),
              "date": format_session_date(related_session) if related_session else "No date",
              "accuracy": round(pct(sum(1 for answer in session_answers if answer["is_correct"]), len(session_answers)), 1),
              "score": sum(answer["score_awarded"] for answer in session_answers),
              "avg_stress": round(avg([row["stress_index"] for row in session_review]), 1),
              "avg_commit_window_ms": round(avg([row["commit_window_ms"] for row in session_review]), 1),
              "focus_events": sum(row["focus_loss_count"] for row in session_review),
          }
      )
    session_history.sort(key=lambda row: row["session_id"], reverse=True)

    overall_story = {
        "headline": (
            "This learner is building stable decision habits."
            if risk_level == "low"
            else "This learner needs targeted reinforcement and pacing support."
            if risk_level == "high"
            else "This learner is close, but still has unstable moments under pressure."
        ),
        "body": (
            "Use the weak-topic and session-pressure signals together. A student can know the material and still lose points through hesitation."
        ),
    }

    return {
        "stats": stats,
        "mastery": mastery_rows,
        "aggregates": aggregates,
        "profile": profile,
        "risk": {
            "score": risk_score,
            "level": risk_level,
            "stress_index": session_stress,
        },
        "tagPerformance": tag_performance,
        "questionReview": question_review,
        "behaviorSignals": behavior_signals,
        "momentum": momentum,
        "sessionSegments": session_segments,
        "sessionHistory": session_history,
        "overallStory": overall_story,
        "highlights": highlights,
        "recommendations": recommendations,
        "adaptiveTargets": adaptive_targets,
        "practicePlan": practice_plan,
    }


def build_practice_set(payload: dict[str, Any]) -> dict[str, Any]:
    desired_count = max(1, as_int(payload.get("count"), 5))
    mastery_map = build_mastery_map(payload.get("mastery"))
    questions = [normalize_question(question) for question in payload.get("questions", [])]
    priority_question_ids = {as_int(question_id) for question_id in payload.get("priority_question_ids", [])}
    requested_focus_tag_list = parse_string_list(payload.get("focus_tags"))
    requested_focus_tags = {tag for tag in requested_focus_tag_list}
    practice_attempts = [
        {
            "question_id": as_int(attempt.get("question_id")),
            "is_correct": as_bool(attempt.get("is_correct")),
            "response_ms": max(0, as_int(attempt.get("response_ms"))),
        }
        for attempt in payload.get("practice_attempts", [])
    ]

    attempt_index: dict[int, dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "correct": 0, "avg_response_ms": 0.0}
    )
    for attempt in practice_attempts:
        entry = attempt_index[attempt["question_id"]]
        entry["count"] += 1
        entry["correct"] += 1 if attempt["is_correct"] else 0
        entry["avg_response_ms"] += attempt["response_ms"]
    for entry in attempt_index.values():
        if entry["count"]:
            entry["avg_response_ms"] = round(entry["avg_response_ms"] / entry["count"], 1)

    weak_tags = sorted(
        mastery_map.items(),
        key=lambda item: (item[1], item[0]),
    )[:3]
    weak_tag_names = {tag for tag, _score in weak_tags} | requested_focus_tags

    scored_questions: list[tuple[float, dict[str, Any]]] = []
    for question in questions:
        question_attempts = attempt_index.get(question["id"], {"count": 0, "correct": 0, "avg_response_ms": 0.0})
        question_tags = question["tags"] or ["general"]

        weakness_score = 0.0
        for tag in question_tags:
            tag_score = mastery_map.get(tag, 45.0)
            weakness_score += max(0.0, 75.0 - tag_score)

        retry_boost = 20.0 if question_attempts["count"] == 0 else 0.0
        if question_attempts["count"] > 0 and question_attempts["correct"] < question_attempts["count"]:
            retry_boost += 18.0

        focus_bonus = 12.0 if any(tag in weak_tag_names for tag in question_tags) else 0.0
        priority_boost = 22.0 if question["id"] in priority_question_ids else 0.0
        repetition_penalty = question_attempts["count"] * 8.0
        score = weakness_score + retry_boost + focus_bonus + priority_boost - repetition_penalty
        scored_questions.append((score, question))

    scored_questions.sort(key=lambda item: (-item[0], item[1]["id"]))

    selected: list[dict[str, Any]] = []
    covered_tags: set[str] = set()
    for _score, question in scored_questions:
        if len(selected) >= desired_count:
            break
        question_tags = set(question["tags"])
        if question_tags and question_tags.issubset(covered_tags) and len(selected) < desired_count - 1:
            continue
        selected.append(question)
        covered_tags.update(question_tags)

    if len(selected) < desired_count:
        selected_ids = {question["id"] for question in selected}
        for _score, question in scored_questions:
            if len(selected) >= desired_count:
                break
            if question["id"] in selected_ids:
                continue
            selected.append(question)
            selected_ids.add(question["id"])

    focus_tags = requested_focus_tag_list or [tag for tag, _score in weak_tags]
    if focus_tags:
        headline = "Practice set tuned to weak areas"
        body = "This round prioritizes " + ", ".join(tag.title() for tag in focus_tags) + "."
    else:
        headline = "Balanced refresh set"
        body = "No clear weak tags yet, so the practice mix stays broad."

    return {
        "questions": selected,
        "strategy": {
            "headline": headline,
            "body": body,
            "focus_tags": focus_tags,
            "priority_question_ids": list(priority_question_ids),
        },
    }


def format_session_date(session: dict[str, Any]) -> str:
    for field in ("ended_at", "started_at"):
        raw_value = session.get(field)
        if not raw_value:
            continue
        try:
            dt = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
            return dt.strftime("%b %d, %Y")
        except ValueError:
            return str(raw_value)
    return "No date"


def build_teacher_overview(payload: dict[str, Any]) -> dict[str, Any]:
    packs = {as_int(pack.get("id")): dict(pack) for pack in payload.get("packs", [])}
    sessions = [dict(session) for session in payload.get("sessions", [])]
    participants = [dict(participant) for participant in payload.get("participants", [])]
    answers = [normalize_answer(answer) for answer in payload.get("answers", [])]
    questions = [normalize_question(question) for question in payload.get("questions", [])]
    logs = [normalize_log(log) for log in payload.get("behavior_logs", [])]

    participants_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    logs_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    questions_by_pack: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for participant in participants:
        participants_by_session[as_int(participant.get("session_id"))].append(participant)
    for answer in answers:
        answers_by_session[answer["session_id"]].append(answer)
    for log in logs:
        logs_by_session[log["session_id"]].append(log)
    for question in questions:
        questions_by_pack[as_int(question.get("quiz_pack_id"))].append(question)

    session_summaries: list[dict[str, Any]] = []
    for session in sessions:
        session_id = as_int(session.get("id"))
        quiz_pack_id = as_int(session.get("quiz_pack_id"))
        dashboard = build_class_dashboard(
            {
                "session": session,
                "participants": participants_by_session.get(session_id, []),
                "questions": questions_by_pack.get(quiz_pack_id, []),
                "answers": answers_by_session.get(session_id, []),
                "behavior_logs": logs_by_session.get(session_id, []),
            }
        )
        summary = dashboard["summary"]
        if summary["participant_count"] == 0 and not answers_by_session.get(session_id):
            continue
        session_summaries.append(
            {
                "session_id": session_id,
                "quiz_pack_id": quiz_pack_id,
                "quiz_name": packs.get(quiz_pack_id, {}).get("title", f"Pack {quiz_pack_id}"),
                "date": format_session_date(session),
                "players": summary["participant_count"],
                "avg_score": round(
                    avg([participant["total_score"] for participant in dashboard["participants"]]), 1
                ),
                "avg_accuracy": summary["overall_accuracy"],
                "stress_index": summary["stress_index"],
                "status": session.get("status", "LOBBY"),
                "pin": session.get("pin"),
                "headline": summary["headline"],
            }
        )

    session_summaries.sort(key=lambda row: row["session_id"], reverse=True)

    all_players = sum(summary["players"] for summary in session_summaries)
    avg_accuracy = round(avg([summary["avg_accuracy"] for summary in session_summaries]), 1)
    avg_stress = round(avg([summary["stress_index"] for summary in session_summaries]), 1)
    hosted_count = sum(1 for session in session_summaries if session["players"] > 0 or session["status"] != "LOBBY")

    insights: list[dict[str, str]] = []
    hardest_session = min(session_summaries, key=lambda row: row["avg_accuracy"], default=None)
    if hardest_session and hardest_session["players"] > 0:
        insights.append(
            {
                "title": "Most challenging session",
                "body": (
                    f"{hardest_session['quiz_name']} settled at {hardest_session['avg_accuracy']:.1f}% accuracy. "
                    "That pack is the best candidate for revision."
                ),
            }
        )
    highest_stress_session = max(session_summaries, key=lambda row: row["stress_index"], default=None)
    if highest_stress_session and highest_stress_session["stress_index"] >= 45:
        insights.append(
            {
                "title": "Highest pressure session",
                "body": (
                    f"{highest_stress_session['quiz_name']} produced a stress index of "
                    f"{highest_stress_session['stress_index']:.0f}. Check time limits and distractor quality."
                ),
            }
        )
    if not insights:
        insights.append(
            {
                "title": "No major risk detected",
                "body": "Recent sessions look stable. Keep using the same pacing and question mix.",
            }
        )

    return {
        "summary": {
            "total_players": all_players,
            "avg_accuracy": avg_accuracy,
            "quizzes_hosted": hosted_count,
            "avg_stress": avg_stress,
        },
        "recent_sessions": session_summaries[:10],
        "insights": insights,
    }
