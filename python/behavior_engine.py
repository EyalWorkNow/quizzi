from __future__ import annotations

from collections import Counter, defaultdict
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


ANALYTICS_VERSION = "quizzi_analytics_v3"
ACTION_LABELS = {
    "reteach_now": "Reteach now",
    "fragile_but_correct": "Fragile but correct",
    "likely_distractor_issue": "Likely distractor issue",
    "needs_calmer_pacing": "Needs calmer pacing",
    "ready_for_stretch": "Ready for stretch",
    "monitor": "Monitor",
}


def classify_band(score: float) -> str:
    if score >= 75:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def build_metric(label: str, value: Any, unit: str = "") -> dict[str, Any]:
    metric = {"label": label, "value": value}
    if unit:
        metric["unit"] = unit
    return metric


def build_data_quality(
    *,
    expected_count: int,
    observed_count: int,
    reconnect_count: int = 0,
    retry_count: int = 0,
    visibility_interruptions: int = 0,
    network_degraded_count: int = 0,
) -> dict[str, Any]:
    missing_answers = max(0, expected_count - observed_count) if expected_count > 0 else 0
    contamination_penalty = (
        (missing_answers * 3.0)
        + (reconnect_count * 2.0)
        + (retry_count * 2.2)
        + (visibility_interruptions * 1.1)
        + (network_degraded_count * 2.4)
    )
    quality_score = round(clamp(100.0 - contamination_penalty, 10.0, 100.0), 1)
    return {
        "expected_count": max(0, expected_count),
        "observed_count": max(0, observed_count),
        "missing_answers": missing_answers,
        "reconnect_count": max(0, reconnect_count),
        "submission_retry_count": max(0, retry_count),
        "visibility_interruptions": max(0, visibility_interruptions),
        "network_degraded_count": max(0, network_degraded_count),
        "quality_score": quality_score,
        "signal_quality": classify_band(quality_score),
    }


def build_teacher_action(action_id: str, body: str, title: str = "") -> dict[str, Any]:
    normalized_id = action_id if action_id in ACTION_LABELS else "monitor"
    label = ACTION_LABELS.get(normalized_id, ACTION_LABELS["monitor"])
    return {
        "id": normalized_id,
        "label": label,
        "title": title or label,
        "body": body,
    }


def build_trust_bundle(
    *,
    evidence_count: int,
    observed_headline: str,
    observed_body: str,
    interpretation_headline: str,
    interpretation_body: str,
    teacher_action: dict[str, Any],
    raw_facts: list[dict[str, Any]],
    grading_safe_metrics: list[dict[str, Any]] | None = None,
    behavior_signal_metrics: list[dict[str, Any]] | None = None,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data_quality = data_quality or build_data_quality(
        expected_count=evidence_count,
        observed_count=evidence_count,
    )
    evidence_score = clamp((min(max(evidence_count, 0), 12) / 12.0) * 100.0, 0.0, 100.0)
    trust_score = round((evidence_score * 0.58) + (as_float(data_quality.get("quality_score")) * 0.42), 1)
    if evidence_count >= 8 and trust_score >= 70:
        confidence_band = "high"
    elif evidence_count >= 4 and trust_score >= 45:
        confidence_band = "medium"
    else:
        confidence_band = "low"

    suppressed_reason = None
    if evidence_count < 3:
        suppressed_reason = "Not enough observations yet to make a high-confidence call."
    elif as_float(data_quality.get("quality_score")) < 45:
        suppressed_reason = "The signal is noisy because this session had missing or unstable telemetry."

    return {
        "analytics_version": ANALYTICS_VERSION,
        "evidence_count": max(0, evidence_count),
        "signal_quality": data_quality.get("signal_quality", classify_band(trust_score)),
        "confidence_band": confidence_band,
        "suppressed_reason": suppressed_reason,
        "raw_facts": raw_facts[:8],
        "observed_facts": {
            "headline": observed_headline,
            "body": observed_body,
        },
        "derived_interpretation": {
            "headline": interpretation_headline,
            "body": interpretation_body,
        },
        "teacher_action": teacher_action,
        "grading_safe_metrics": grading_safe_metrics or [],
        "behavior_signal_metrics": behavior_signal_metrics or [],
        "data_quality": data_quality,
    }


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
    normalized["learning_objective"] = str(question.get("learning_objective", "")).strip()
    normalized["bloom_level"] = str(question.get("bloom_level", "")).strip()
    normalized["concept_id"] = str(question.get("concept_id") or normalized["learning_objective"] or "").strip()
    normalized["stem_length_chars"] = max(0, as_int(question.get("stem_length_chars"), len(normalized["prompt"])))
    normalized["prompt_complexity_score"] = max(0, min(100, as_int(question.get("prompt_complexity_score"))))
    normalized["reading_difficulty"] = str(question.get("reading_difficulty", "")).strip() or "basic"
    normalized["media_type"] = str(question.get("media_type", "")).strip() or ("image" if str(question.get("image_url", "")).strip() else "text")
    normalized["distractor_profile_json"] = str(question.get("distractor_profile_json") or "{}")
    normalized["question_position_policy"] = str(question.get("question_position_policy", "")).strip() or "fixed_pack_order"

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
    normalized["submission_retry_count"] = max(0, as_int(log.get("submission_retry_count")))
    normalized["reconnect_count"] = max(0, as_int(log.get("reconnect_count")))
    normalized["visibility_interruptions"] = max(0, as_int(log.get("visibility_interruptions")))
    normalized["outside_answer_pointer_moves"] = max(0, as_int(log.get("outside_answer_pointer_moves")))
    normalized["rapid_pointer_jumps"] = max(0, as_int(log.get("rapid_pointer_jumps")))
    normalized["network_degraded"] = as_bool(log.get("network_degraded"))
    normalized["device_profile"] = str(log.get("device_profile") or "").strip().lower()
    normalized["analytics_version"] = str(log.get("analytics_version") or ANALYTICS_VERSION).strip()
    normalized["option_dwell"] = {
        str(key): max(0.0, as_float(value))
        for key, value in parse_json_object(log.get("option_dwell") or log.get("option_dwell_json")).items()
    }
    normalized["option_hover_counts"] = {
        str(key): max(0, as_int(value))
        for key, value in parse_json_object(log.get("option_hover_counts") or log.get("option_hover_counts_json")).items()
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


def normalize_behavior_event(event: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(event)
    normalized["id"] = as_int(event.get("id"))
    normalized["session_id"] = as_int(event.get("session_id"))
    normalized["question_id"] = as_int(event.get("question_id"))
    normalized["participant_id"] = as_int(event.get("participant_id"))
    normalized["event_type"] = str(event.get("event_type") or "").strip().lower()
    normalized["event_ts_ms"] = max(0, as_int(event.get("event_ts_ms")))
    normalized["event_seq"] = max(0, as_int(event.get("event_seq")))
    option_index = as_int(event.get("option_index"), -1)
    normalized["option_index"] = option_index if option_index >= 0 else None
    normalized["payload_json"] = str(event.get("payload_json") or "").strip()
    normalized["payload"] = parse_json_object(event.get("payload_json"))
    normalized["network_latency_ms"] = max(0, as_int(event.get("network_latency_ms")))
    normalized["client_render_delay_ms"] = max(0, as_int(event.get("client_render_delay_ms")))
    normalized["device_profile"] = str(event.get("device_profile") or "").strip().lower()
    normalized["analytics_version"] = str(event.get("analytics_version") or ANALYTICS_VERSION).strip()
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


def build_behavior_event_lookup(events: list[dict[str, Any]]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    events_by_pair: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        participant_id = as_int(event.get("participant_id"))
        question_id = as_int(event.get("question_id"))
        if participant_id <= 0 or question_id <= 0:
            continue
        events_by_pair[(participant_id, question_id)].append(event)

    for key, rows in events_by_pair.items():
        rows.sort(key=lambda row: (as_int(row.get("event_seq")), as_int(row.get("event_ts_ms")), as_int(row.get("id"))))
        events_by_pair[key] = rows
    return events_by_pair


def build_event_sequence_overlay(
    events: list[dict[str, Any]],
    response_ms: int,
) -> dict[str, Any]:
    if not events:
        return {
            "event_count": 0,
            "path": [],
            "states": [],
            "distinct_options": 0,
            "total_swaps": 0,
            "deadline_buffer_ms": max(0, response_ms),
            "commit_window_ms": 0,
            "prompt_reread_count": 0,
            "media_open_count": 0,
            "ui_freeze_count": 0,
            "network_change_count": 0,
        }

    ordered_events = sorted(
        events,
        key=lambda row: (as_int(row.get("event_seq")), as_int(row.get("event_ts_ms")), as_int(row.get("id"))),
    )
    selection_path = [
        {
            "index": as_int(event.get("option_index")),
            "timestamp": max(0, as_int(event.get("event_ts_ms"))),
        }
        for event in ordered_events
        if str(event.get("event_type")) == "option_selected" and event.get("option_index") is not None
    ]
    normalized_path = normalize_answer_path_timestamps(selection_path, response_ms)
    submit_ts = max(
        [as_int(event.get("event_ts_ms")) for event in ordered_events if str(event.get("event_type")) == "submit_clicked"] or [response_ms]
    )
    first_selection_ts = normalized_path[0]["timestamp"] if normalized_path else response_ms
    last_selection_ts = normalized_path[-1]["timestamp"] if normalized_path else 0
    distinct_options = len({item["index"] for item in normalized_path})
    total_swaps = sum(
        1
        for index in range(1, len(normalized_path))
        if normalized_path[index - 1]["index"] != normalized_path[index]["index"]
    )
    deadline_buffer_ms = max(0, submit_ts - last_selection_ts) if normalized_path else max(0, response_ms)
    commit_window_ms = max(0, submit_ts - first_selection_ts) if normalized_path else 0
    prompt_reread_count = sum(1 for event in ordered_events if str(event.get("event_type")) == "prompt_reread")
    media_open_count = sum(1 for event in ordered_events if str(event.get("event_type")) == "media_opened")
    ui_freeze_count = sum(1 for event in ordered_events if str(event.get("event_type")) == "ui_freeze_detected")
    network_change_count = sum(1 for event in ordered_events if str(event.get("event_type")) == "network_state_changed")
    hover_count = sum(1 for event in ordered_events if str(event.get("event_type")) == "option_hover_start")

    states: list[str] = []
    if not normalized_path:
        states.append("read_only")
    elif first_selection_ts > 1200 or prompt_reread_count > 0:
        states.append("read_only")
    if normalized_path:
        states.append("first_pick")
    if distinct_options > 1 or hover_count > 0 or prompt_reread_count > 0:
        states.append("option_scan")
    if total_swaps >= 2 or distinct_options >= 3:
        states.append("oscillation")
    if deadline_buffer_ms <= 1000 or ui_freeze_count > 0:
        states.append("deadline_panic")
    if normalized_path and submit_ts >= 0:
        states.append("final_commit")

    return {
        "event_count": len(ordered_events),
        "path": normalized_path,
        "states": list(dict.fromkeys(states)),
        "distinct_options": distinct_options,
        "total_swaps": total_swaps,
        "deadline_buffer_ms": deadline_buffer_ms,
        "commit_window_ms": commit_window_ms,
        "prompt_reread_count": prompt_reread_count,
        "media_open_count": media_open_count,
        "ui_freeze_count": ui_freeze_count,
        "network_change_count": network_change_count,
    }


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


def option_label(index: int) -> str:
    if index < 0:
        return "?"
    if index < 26:
        return chr(65 + index)
    return str(index + 1)


def option_text(question: dict[str, Any], index: int) -> str:
    answers = question.get("answers") or []
    if 0 <= index < len(answers):
        text = str(answers[index]).strip()
        if text:
            return text
    return f"Option {option_label(index)}"


def revision_outcome_label(outcome_id: str) -> str:
    labels = {
        "correct_locked_in": "Correct locked in",
        "correct_verified": "Correct verified",
        "correct_to_incorrect": "Correct to incorrect",
        "incorrect_to_correct": "Incorrect to correct",
        "incorrect_to_incorrect": "Incorrect to incorrect",
    }
    return labels.get(outcome_id, outcome_id.replace("_", " ").title())


def analyze_choice_journey(
    answer: dict[str, Any],
    question: dict[str, Any],
    log: dict[str, Any] | None,
) -> dict[str, Any]:
    decision_path = summarize_decision_path(
        response_ms=answer["response_ms"],
        time_limit_seconds=question["time_limit_seconds"],
        log=log,
    )
    path = decision_path["path"]
    final_index = answer["chosen_index"] if answer["chosen_index"] >= 0 else (path[-1]["index"] if path else -1)
    first_index = path[0]["index"] if path else final_index
    correct_index = question["correct_index"]
    first_correct = first_index == correct_index if first_index >= 0 else False
    final_correct = final_index == correct_index if final_index >= 0 else answer["is_correct"]
    changed_answer = bool(path) and any(item["index"] != path[0]["index"] for item in path[1:])

    first_touch_final_ms: int | None = None
    final_option_touch_count = 0
    for item in path:
        if item["index"] == final_index:
            final_option_touch_count += 1
            if first_touch_final_ms is None:
                first_touch_final_ms = item["timestamp"]

    fallback_commit_window_ms = (
        as_int(log.get("final_decision_buffer_ms")) if log else decision_path["commit_window_ms"]
    )
    if first_touch_final_ms is None:
        first_touch_final_ms = max(0, answer["response_ms"] - fallback_commit_window_ms)

    commitment_latency_ms = max(0, answer["response_ms"] - first_touch_final_ms)
    verification_behavior = (
        first_correct
        and final_correct
        and (
            changed_answer
            or final_option_touch_count > 1
            or (log and as_int(log.get("same_answer_reclicks")) > 0)
            or commitment_latency_ms >= 1800
        )
    )

    if first_correct and not final_correct:
        revision_outcome = "correct_to_incorrect"
    elif not first_correct and final_correct:
        revision_outcome = "incorrect_to_correct"
    elif not first_correct and not final_correct:
        revision_outcome = "incorrect_to_incorrect"
    elif verification_behavior:
        revision_outcome = "correct_verified"
    else:
        revision_outcome = "correct_locked_in"

    deadline_buffer_ms = decision_path["deadline_buffer_ms"]
    under_time_pressure = deadline_buffer_ms <= 5000 or (log and as_int(log.get("panic_swaps")) > 0)
    deadline_dependent = deadline_buffer_ms <= 1000

    return {
        "first_choice_index": first_index,
        "first_choice_label": option_label(first_index),
        "first_choice_text": option_text(question, first_index),
        "first_choice_correct": first_correct,
        "final_choice_index": final_index,
        "final_choice_label": option_label(final_index),
        "final_choice_text": option_text(question, final_index),
        "final_choice_correct": final_correct,
        "first_touch_final_ms": first_touch_final_ms,
        "commitment_latency_ms": commitment_latency_ms,
        "changed_answer": changed_answer,
        "final_option_touch_count": final_option_touch_count,
        "verification_behavior": verification_behavior,
        "revision_outcome": revision_outcome,
        "revision_outcome_label": revision_outcome_label(revision_outcome),
        "under_time_pressure": bool(under_time_pressure),
        "deadline_dependent": bool(deadline_dependent),
    }


def build_revision_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    counter = Counter(str(row.get("revision_outcome", "")) for row in rows if row.get("revision_outcome"))
    categories = []
    for outcome_id in (
        "incorrect_to_correct",
        "correct_to_incorrect",
        "incorrect_to_incorrect",
        "correct_verified",
        "correct_locked_in",
    ):
        count = counter.get(outcome_id, 0)
        categories.append(
            {
                "id": outcome_id,
                "label": revision_outcome_label(outcome_id),
                "count": count,
                "rate": round(pct(count, total), 1),
            }
        )

    first_choice_correct_count = sum(1 for row in rows if as_bool(row.get("first_choice_correct")))
    corrected_after_wrong = counter.get("incorrect_to_correct", 0)
    changed_away_from_correct = counter.get("correct_to_incorrect", 0)
    stayed_wrong = counter.get("incorrect_to_incorrect", 0)
    verified_correct = counter.get("correct_verified", 0)

    return {
        "total": total,
        "first_choice_correct_count": first_choice_correct_count,
        "first_choice_correct_rate": round(pct(first_choice_correct_count, total), 1),
        "corrected_after_wrong_count": corrected_after_wrong,
        "corrected_after_wrong_rate": round(pct(corrected_after_wrong, total), 1),
        "changed_away_from_correct_count": changed_away_from_correct,
        "changed_away_from_correct_rate": round(pct(changed_away_from_correct, total), 1),
        "stayed_wrong_count": stayed_wrong,
        "stayed_wrong_rate": round(pct(stayed_wrong, total), 1),
        "verified_correct_count": verified_correct,
        "verified_correct_rate": round(pct(verified_correct, total), 1),
        "categories": categories,
    }


def build_deadline_profile(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    last_second_rows = [row for row in rows if as_int(row.get("deadline_buffer_ms")) <= 1000]
    pressure_rows = [row for row in rows if as_bool(row.get("under_time_pressure"))]
    correct_rows = [row for row in rows if as_bool(row.get("is_correct"))]
    incorrect_rows = [row for row in rows if not as_bool(row.get("is_correct"))]

    last_second_correct = sum(1 for row in last_second_rows if as_bool(row.get("is_correct")))
    last_second_incorrect = len(last_second_rows) - last_second_correct
    errors_under_pressure = sum(1 for row in incorrect_rows if as_bool(row.get("under_time_pressure")))
    correct_under_pressure = sum(1 for row in correct_rows if as_bool(row.get("under_time_pressure")))

    return {
        "total": total,
        "pressure_count": len(pressure_rows),
        "pressure_rate": round(pct(len(pressure_rows), total), 1),
        "last_second_count": len(last_second_rows),
        "last_second_rate": round(pct(len(last_second_rows), total), 1),
        "last_second_correct_count": last_second_correct,
        "last_second_correct_rate": round(pct(last_second_correct, len(correct_rows)), 1),
        "last_second_error_count": last_second_incorrect,
        "last_second_error_rate": round(pct(last_second_incorrect, len(incorrect_rows)), 1),
        "correct_under_pressure_count": correct_under_pressure,
        "correct_under_pressure_rate": round(pct(correct_under_pressure, len(correct_rows)), 1),
        "errors_under_pressure_count": errors_under_pressure,
        "errors_under_pressure_rate": round(pct(errors_under_pressure, len(incorrect_rows)), 1),
    }


def build_fatigue_drift(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ordered_rows = sorted(
        rows,
        key=lambda row: (as_int(row.get("session_id")), as_int(row.get("question_index"))),
    )
    if not ordered_rows:
        return {
            "direction": "flat",
            "headline": "No session drift yet.",
            "body": "There are not enough answered questions to estimate fatigue drift.",
            "early_accuracy": 0.0,
            "late_accuracy": 0.0,
            "accuracy_delta": 0.0,
            "early_response_ms": 0.0,
            "late_response_ms": 0.0,
            "response_delta_ms": 0.0,
            "early_volatility": 0.0,
            "late_volatility": 0.0,
            "volatility_delta": 0.0,
        }

    midpoint = max(1, len(ordered_rows) // 2)
    early = ordered_rows[:midpoint]
    late = ordered_rows[midpoint:] or ordered_rows[-midpoint:]
    early_accuracy = round(pct(sum(1 for row in early if as_bool(row.get("is_correct"))), len(early)), 1)
    late_accuracy = round(pct(sum(1 for row in late if as_bool(row.get("is_correct"))), len(late)), 1)
    early_response_ms = round(avg([as_int(row.get("response_ms")) for row in early]), 1)
    late_response_ms = round(avg([as_int(row.get("response_ms")) for row in late]), 1)
    early_volatility = round(avg([as_float(row.get("decision_volatility")) for row in early]), 1)
    late_volatility = round(avg([as_float(row.get("decision_volatility")) for row in late]), 1)
    accuracy_delta = round(late_accuracy - early_accuracy, 1)
    response_delta_ms = round(late_response_ms - early_response_ms, 1)
    volatility_delta = round(late_volatility - early_volatility, 1)

    if accuracy_delta <= -12 and (response_delta_ms >= 800 or volatility_delta >= 10):
        direction = "fatigue"
        headline = "Performance faded in the back half."
        body = "Later questions were less accurate and more effortful, which is consistent with fatigue or overload."
    elif accuracy_delta >= 12 and volatility_delta <= 0:
        direction = "settling_in"
        headline = "Performance improved as the session progressed."
        body = "The later half was more accurate without a matching volatility spike, suggesting the learner settled in."
    elif volatility_delta <= -12 and accuracy_delta >= -5:
        direction = "stabilizing"
        headline = "Decision-making became more stable over time."
        body = "Later questions showed calmer commitment patterns even without a large accuracy jump."
    else:
        direction = "flat"
        headline = "No strong fatigue drift emerged."
        body = "Accuracy, pace, and volatility stayed within a relatively narrow band across the session."

    return {
        "direction": direction,
        "headline": headline,
        "body": body,
        "early_accuracy": early_accuracy,
        "late_accuracy": late_accuracy,
        "accuracy_delta": accuracy_delta,
        "early_response_ms": early_response_ms,
        "late_response_ms": late_response_ms,
        "response_delta_ms": response_delta_ms,
        "early_volatility": early_volatility,
        "late_volatility": late_volatility,
        "volatility_delta": volatility_delta,
    }


def build_recovery_profile(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ordered_rows = sorted(
        rows,
        key=lambda row: (as_int(row.get("session_id")), as_int(row.get("question_index"))),
    )
    misses = [index for index, row in enumerate(ordered_rows[:-1]) if not as_bool(row.get("is_correct"))]
    if not misses:
        return {
            "total_followups": 0,
            "recovered_count": 0,
            "continued_error_count": 0,
            "impulsive_after_error_count": 0,
            "hesitant_after_error_count": 0,
            "recovery_rate": 100.0,
            "dominant_pattern": "No misses",
        }

    response_baseline = max(1.0, percentile([as_int(row.get("response_ms")) for row in ordered_rows], 0.5))
    commit_baseline = max(
        1.0,
        percentile([as_int(row.get("commitment_latency_ms")) for row in ordered_rows], 0.5),
    )
    counts = Counter()
    for miss_index in misses:
        next_row = ordered_rows[miss_index + 1]
        if as_bool(next_row.get("is_correct")):
            counts["recovered"] += 1
        elif as_int(next_row.get("response_ms")) <= response_baseline * 0.75:
            counts["impulsive_after_error"] += 1
        elif (
            as_int(next_row.get("response_ms")) >= response_baseline * 1.35
            or as_int(next_row.get("commitment_latency_ms")) >= commit_baseline * 1.35
        ):
            counts["hesitant_after_error"] += 1
        else:
            counts["continued_error"] += 1

    total_followups = sum(counts.values())
    dominant_pattern_id = counts.most_common(1)[0][0] if counts else "continued_error"
    dominant_labels = {
        "recovered": "Recovers well",
        "continued_error": "Carries the error forward",
        "impulsive_after_error": "Gets impulsive after misses",
        "hesitant_after_error": "Gets hesitant after misses",
    }
    return {
        "total_followups": total_followups,
        "recovered_count": counts.get("recovered", 0),
        "continued_error_count": counts.get("continued_error", 0),
        "impulsive_after_error_count": counts.get("impulsive_after_error", 0),
        "hesitant_after_error_count": counts.get("hesitant_after_error", 0),
        "recovery_rate": round(pct(counts.get("recovered", 0), total_followups), 1),
        "dominant_pattern": dominant_labels.get(dominant_pattern_id, dominant_pattern_id.replace("_", " ").title()),
    }


def combine_recovery_profiles(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    total_followups = sum(as_int(profile.get("total_followups")) for profile in profiles)
    recovered_count = sum(as_int(profile.get("recovered_count")) for profile in profiles)
    continued_error_count = sum(as_int(profile.get("continued_error_count")) for profile in profiles)
    impulsive_after_error_count = sum(as_int(profile.get("impulsive_after_error_count")) for profile in profiles)
    hesitant_after_error_count = sum(as_int(profile.get("hesitant_after_error_count")) for profile in profiles)
    counts = {
        "Recovers well": recovered_count,
        "Carries the error forward": continued_error_count,
        "Gets impulsive after misses": impulsive_after_error_count,
        "Gets hesitant after misses": hesitant_after_error_count,
    }
    dominant_pattern = max(counts.items(), key=lambda item: item[1])[0] if total_followups else "No misses"
    return {
        "total_followups": total_followups,
        "recovered_count": recovered_count,
        "continued_error_count": continued_error_count,
        "impulsive_after_error_count": impulsive_after_error_count,
        "hesitant_after_error_count": hesitant_after_error_count,
        "recovery_rate": round(pct(recovered_count, total_followups), 1) if total_followups else 100.0,
        "dominant_pattern": dominant_pattern,
    }


def build_misconception_patterns(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    patterns: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "tag": "",
            "choice_text": "",
            "choice_label": "",
            "count": 0,
            "question_ids": set(),
            "question_indexes": set(),
            "participants": set(),
        }
    )

    for row in rows:
        if as_bool(row.get("is_correct")):
            continue
        choice_text = str(row.get("final_choice_text") or "").strip()
        if not choice_text:
            continue
        tags = row.get("tags") or []
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
        for tag in tags or ["general"]:
            key = (str(tag).strip().lower(), choice_text.lower())
            entry = patterns[key]
            entry["tag"] = str(tag).strip() or "general"
            entry["choice_text"] = choice_text
            entry["choice_label"] = str(row.get("final_choice_label") or "")
            entry["count"] += 1
            entry["question_ids"].add(as_int(row.get("question_id")))
            entry["question_indexes"].add(as_int(row.get("question_index")))
            if row.get("participant_id") is not None:
                entry["participants"].add(as_int(row.get("participant_id")))

    rows_out: list[dict[str, Any]] = []
    for entry in patterns.values():
        if entry["count"] < 2:
            continue
        rows_out.append(
            {
                "tag": entry["tag"],
                "choice_text": entry["choice_text"],
                "choice_label": entry["choice_label"],
                "count": entry["count"],
                "question_count": len(entry["question_ids"]),
                "student_count": len(entry["participants"]),
                "question_indexes": sorted(index for index in entry["question_indexes"] if index > 0),
            }
        )

    rows_out.sort(
        key=lambda row: (-row["count"], -row["question_count"], row["tag"], row["choice_text"].lower())
    )
    return rows_out[:6]


def extract_signal_score(signals: list[dict[str, Any]], signal_id: str) -> float:
    for signal in signals:
        if str(signal.get("id")) == signal_id:
            return round(as_float(signal.get("score")), 1)
    return 0.0


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


def compute_focus_score(
    total_focus_loss: float,
    avg_idle_time_ms: float,
    avg_blur_time_ms: float = 0.0,
) -> int:
    return round(
        clamp(
            100.0
            - (total_focus_loss * 10.0)
            - (avg_idle_time_ms / 1500.0)
            - (avg_blur_time_ms / 260.0),
            0.0,
            100.0,
        )
    )


def build_confidence_contributors(
    accuracy: float,
    avg_tfi_ms: float,
    avg_swaps: float,
    total_panic_swaps: float,
    total_focus_loss: float = 0.0,
    avg_blur_time_ms: float = 0.0,
) -> list[dict[str, Any]]:
    contributors = [
        {"id": "accuracy", "impact": round(accuracy * 0.55, 1), "value": round(accuracy, 1)},
        {"id": "swaps", "impact": round(-min(avg_swaps * 8.0, 18.0), 1), "value": round(avg_swaps, 2)},
        {
            "id": "panic_swaps",
            "impact": round(-min(total_panic_swaps * 6.0, 18.0), 1),
            "value": round(total_panic_swaps, 1),
        },
        {
            "id": "focus_loss",
            "impact": round(-min(total_focus_loss * 4.0, 16.0), 1),
            "value": round(total_focus_loss, 1),
        },
        {
            "id": "blur_time_ms",
            "impact": round(-min(avg_blur_time_ms / 550.0, 12.0), 1),
            "value": round(avg_blur_time_ms, 1),
        },
    ]
    if avg_tfi_ms > 10000:
        contributors.append({"id": "slow_tfi", "impact": -8.0, "value": round(avg_tfi_ms, 1)})
    elif avg_tfi_ms < 1800 and accuracy < 55:
        contributors.append({"id": "fast_guessing", "impact": -10.0, "value": round(avg_tfi_ms, 1)})
    return contributors


def compute_confidence_score(
    accuracy: float,
    avg_tfi_ms: float,
    avg_swaps: float,
    total_panic_swaps: float,
    total_focus_loss: float = 0.0,
    avg_blur_time_ms: float = 0.0,
) -> int:
    confidence = 45.0 + (accuracy * 0.55)
    confidence -= min(avg_swaps * 8.0, 18.0)
    confidence -= min(total_panic_swaps * 6.0, 18.0)
    confidence -= min(total_focus_loss * 4.0, 16.0)
    confidence -= min(avg_blur_time_ms / 550.0, 12.0)
    if avg_tfi_ms > 10000:
        confidence -= 8.0
    elif avg_tfi_ms < 1800 and accuracy < 55:
        confidence -= 10.0
    return round(clamp(confidence, 0.0, 100.0))


def compute_engagement_score(
    focus_loss_count: float,
    idle_time_ms: float,
    blur_time_ms: float,
    visibility_interruptions: float = 0.0,
    retry_count: float = 0.0,
    reconnect_count: float = 0.0,
    network_degraded: bool = False,
) -> float:
    score = (
        100.0
        - (focus_loss_count * 12.0)
        - (idle_time_ms / 1600.0)
        - (blur_time_ms / 260.0)
        - (visibility_interruptions * 4.0)
        - (retry_count * 6.0)
        - (reconnect_count * 5.0)
        - (8.0 if network_degraded else 0.0)
    )
    return round(clamp(score, 0.0, 100.0), 1)


def classify_engagement_state(engagement_score: float) -> str:
    if engagement_score >= 75:
        return "engaged"
    if engagement_score >= 45:
        return "unstable"
    return "disengaged"


def build_path_states(
    *,
    path: list[dict[str, int]],
    total_swaps: int,
    flip_flops: int,
    revisit_count: int,
    focus_loss_count: int,
    deadline_buffer_ms: int,
    panic_swaps: int,
) -> list[str]:
    states: list[str] = []
    if not path:
        states.append("read_only")
    elif path[0]["timestamp"] > 1200:
        states.append("read_only")
    if path:
        states.append("first_pick")
    if len({item["index"] for item in path}) > 1:
        states.append("option_scan")
    if total_swaps >= 2 or flip_flops > 0 or revisit_count >= 2:
        states.append("oscillation")
    if focus_loss_count > 0 and "option_scan" not in states:
        states.append("option_scan")
    if deadline_buffer_ms <= 1000 or panic_swaps > 0:
        states.append("deadline_panic")
    if path:
        states.append("final_commit")
    return list(dict.fromkeys(states))


def classify_path_type(
    *,
    is_correct: bool,
    verification_behavior: bool,
    total_swaps: int,
    flip_flops: int,
    revisit_count: int,
    distinct_options: int,
    deadline_buffer_ms: int,
    panic_swaps: int,
    focus_loss_count: int,
    engagement_score: float,
    commit_window_ms: int,
) -> str:
    if engagement_score < 40 and (focus_loss_count > 0 or distinct_options == 0):
        return "disengaged_path"
    if (deadline_buffer_ms <= 1000 or panic_swaps > 0) and not is_correct:
        return "last_second_collapse"
    if total_swaps >= 3 or flip_flops > 0 or revisit_count >= 2:
        return "oscillation_loop"
    if verification_behavior or commit_window_ms >= 2000 or distinct_options >= 2:
        return "calm_verification"
    return "early_lock"


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


def select_student_action(
    *,
    accuracy: float,
    stress_index: float,
    focus_score: float,
    changed_away_from_correct_count: int,
    deadline_dependency_rate: float,
    weak_tags: list[str],
) -> dict[str, Any]:
    weak_text = ", ".join(tag.title() for tag in weak_tags[:2]) or "the weakest concept cluster"
    if accuracy < 55:
        return build_teacher_action(
            "reteach_now",
            f"Reteach {weak_text} before the next checkpoint and keep the same material visible while the learner rebuilds accuracy.",
        )
    if changed_away_from_correct_count > 0 and accuracy >= 65:
        return build_teacher_action(
            "fragile_but_correct",
            "The learner can reach correct answers, but needs support locking them sooner instead of revising away late.",
        )
    if stress_index >= 60 or deadline_dependency_rate >= 25 or focus_score < 60:
        return build_teacher_action(
            "needs_calmer_pacing",
            "Reuse the same concepts with a calmer tempo, fewer look-alike distractors, and more explicit commitment prompts.",
        )
    if accuracy >= 85 and focus_score >= 75 and stress_index < 35:
        return build_teacher_action(
            "ready_for_stretch",
            "This learner is stable enough for a harder extension round or a broader mixed review set.",
        )
    return build_teacher_action(
        "monitor",
        "Keep monitoring the next live round and check whether the same weak tags stay unstable.",
    )


def select_question_action(question_row: dict[str, Any]) -> dict[str, Any]:
    top_distractor_rate = as_float((question_row.get("top_distractor") or {}).get("rate"))
    if question_row["accuracy"] < 55:
        return build_teacher_action(
            "reteach_now",
            "Reteach the core distinction before reusing this item; the class did not show enough stable mastery here.",
        )
    if top_distractor_rate >= 20:
        return build_teacher_action(
            "likely_distractor_issue",
            "Contrast the sticky distractor with the correct idea and tighten the wording before the next live run.",
        )
    if as_float(question_row.get("changed_away_from_correct_rate")) >= 15:
        return build_teacher_action(
            "fragile_but_correct",
            "Students were often correct before revising away, so coach commitment on this concept instead of only reteaching content.",
        )
    if question_row["stress_index"] >= 60 or as_float(question_row.get("deadline_dependency_rate")) >= 25:
        return build_teacher_action(
            "needs_calmer_pacing",
            "Keep the concept but reduce pacing pressure or add one calmer re-check before lock-in.",
        )
    if question_row["accuracy"] >= 85 and question_row["stress_index"] < 35:
        return build_teacher_action(
            "ready_for_stretch",
            "This item is stable enough to use as a bridge into a more demanding follow-up question.",
        )
    return build_teacher_action(
        "monitor",
        "Leave this question in rotation and monitor whether the same signal returns in the next session.",
    )


def select_class_action(
    *,
    overall_accuracy: float,
    stress_index: float,
    first_choice_accuracy: float,
    focus_watch_count: int,
    participant_count: int,
    top_distractor_rate: float,
) -> dict[str, Any]:
    if overall_accuracy < 55:
        return build_teacher_action(
            "reteach_now",
            "Pause for a guided recap before the next graded checkpoint; the class has not shown enough stable accuracy yet.",
        )
    if top_distractor_rate >= 20:
        return build_teacher_action(
            "likely_distractor_issue",
            "Review the sticky distractor and the wording around it before you move on to fresh content.",
        )
    if first_choice_accuracy - overall_accuracy >= 10:
        return build_teacher_action(
            "fragile_but_correct",
            "Students often start correctly but wobble before submitting. Coach commitment and verification, not just content.",
        )
    if stress_index >= 55 or focus_watch_count >= max(2, ceil(participant_count * 0.25)):
        return build_teacher_action(
            "needs_calmer_pacing",
            "Slow the pace, shorten the prompt load, and give the room one quick verbal reset before the next live question.",
        )
    if overall_accuracy >= 82 and stress_index < 35:
        return build_teacher_action(
            "ready_for_stretch",
            "The room is stable enough to stretch into a harder item, an explanation round, or a mixed-review challenge.",
        )
    return build_teacher_action(
        "monitor",
        "Keep scanning the next question for a clearer misconception or pressure hotspot before you change the lesson plan.",
    )


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
                "first_choice_accuracy": row.get("first_choice_accuracy", 0.0),
                "corrected_after_wrong_rate": row.get("corrected_after_wrong_rate", 0.0),
                "changed_away_from_correct_rate": row.get("changed_away_from_correct_rate", 0.0),
                "avg_commitment_latency_ms": row.get("avg_commitment_latency_ms", 0.0),
                "deadline_dependency_rate": row.get("deadline_dependency_rate", 0.0),
                "top_distractor": row.get("top_distractor"),
                "choice_distribution": row.get("choice_distribution", []),
                "avg_response_ms": row["avg_response_ms"],
                "avg_swaps": row["avg_swaps"],
                "avg_blur_time_ms": row["avg_blur_time_ms"],
                "avg_interaction_intensity": row["avg_interaction_intensity"],
                "analytics_version": row.get("analytics_version", ANALYTICS_VERSION),
                "signal_quality": row.get("signal_quality", "low"),
                "confidence_band": row.get("confidence_band", "low"),
                "evidence_count": row.get("evidence_count", 0),
                "suppressed_reason": row.get("suppressed_reason"),
                "raw_facts": row.get("raw_facts", []),
                "observed_facts": row.get("observed_facts"),
                "derived_interpretation": row.get("derived_interpretation"),
                "teacher_action": row.get("teacher_action"),
                "grading_safe_metrics": row.get("grading_safe_metrics", []),
                "behavior_signal_metrics": row.get("behavior_signal_metrics", []),
                "data_quality": row.get("data_quality", {}),
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
            "commitment_latency_ms": build_stat_summary([]),
            "deadline_buffer_ms": build_stat_summary([]),
            "revision_outcomes": [],
            "first_choice_correct_rate": 0.0,
            "deadline_dependency_rate": 0.0,
        }

    pace_counts: dict[str, int] = defaultdict(int)
    commit_counts: dict[str, int] = defaultdict(int)
    pace_accuracy: dict[str, list[int]] = defaultdict(list)
    commit_accuracy: dict[str, list[int]] = defaultdict(list)
    revision_counts: Counter[str] = Counter()

    for row in research_rows:
        pace = str(row.get("pace_label", "unknown"))
        commit_style = str(row.get("commit_style", "unknown"))
        is_correct = as_int(row.get("is_correct"))
        pace_counts[pace] += 1
        commit_counts[commit_style] += 1
        pace_accuracy[pace].append(is_correct)
        commit_accuracy[commit_style].append(is_correct)
        revision_counts[str(row.get("revision_outcome", "unknown"))] += 1

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
        "commitment_latency_ms": build_stat_summary([row["commitment_latency_ms"] for row in research_rows]),
        "deadline_buffer_ms": build_stat_summary([row["deadline_buffer_ms"] for row in research_rows]),
        "revision_outcomes": [
            {"id": outcome_id, "label": revision_outcome_label(outcome_id), "count": count}
            for outcome_id, count in revision_counts.most_common()
        ],
        "first_choice_correct_rate": round(
            pct(sum(as_int(row.get("first_choice_correct")) for row in research_rows), len(research_rows)),
            1,
        ),
        "deadline_dependency_rate": round(
            pct(sum(as_int(row.get("deadline_dependent")) for row in research_rows), len(research_rows)),
            1,
        ),
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
        choice_journey = analyze_choice_journey(answer, question, log)
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
                "first_choice_index": choice_journey["first_choice_index"],
                "first_choice_label": choice_journey["first_choice_label"],
                "first_choice_text": choice_journey["first_choice_text"],
                "first_choice_correct": 1 if choice_journey["first_choice_correct"] else 0,
                "final_choice_label": choice_journey["final_choice_label"],
                "final_choice_text": choice_journey["final_choice_text"],
                "changed_answer": 1 if choice_journey["changed_answer"] else 0,
                "revision_outcome": choice_journey["revision_outcome"],
                "revision_outcome_label": choice_journey["revision_outcome_label"],
                "verification_behavior": 1 if choice_journey["verification_behavior"] else 0,
                "commitment_latency_ms": choice_journey["commitment_latency_ms"],
                "deadline_dependent": 1 if choice_journey["deadline_dependent"] else 0,
                "under_time_pressure": 1 if choice_journey["under_time_pressure"] else 0,
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
            "participants": set(),
            "response_values": [],
            "tfi_values": [],
            "commitment_values": [],
            "volatility_values": [],
            "swap_total": 0,
            "panic_total": 0,
            "focus_values": [],
            "first_choice_correct": 0,
            "corrected_after_wrong": 0,
            "changed_away_from_correct": 0,
            "deadline_dependent": 0,
        }
    )

    for answer in answers:
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant_log = logs_by_pair.get((answer["participant_id"], answer["question_id"]))
        decision_path = summarize_decision_path(
            response_ms=answer["response_ms"],
            time_limit_seconds=question["time_limit_seconds"],
            log=participant_log,
        )
        choice_journey = analyze_choice_journey(answer, question, participant_log)
        for tag in question["tags"] or ["general"]:
            entry = tag_aggregate[tag]
            entry["tag"] = tag
            entry["attempts"] += 1
            entry["correct"] += 1 if answer["is_correct"] else 0
            entry["participants"].add(answer["participant_id"])
            entry["response_values"].append(answer["response_ms"])
            entry["commitment_values"].append(choice_journey["commitment_latency_ms"])
            entry["volatility_values"].append(decision_path["decision_volatility"])
            entry["first_choice_correct"] += 1 if choice_journey["first_choice_correct"] else 0
            entry["corrected_after_wrong"] += 1 if choice_journey["revision_outcome"] == "incorrect_to_correct" else 0
            entry["changed_away_from_correct"] += 1 if choice_journey["revision_outcome"] == "correct_to_incorrect" else 0
            entry["deadline_dependent"] += 1 if choice_journey["deadline_dependent"] else 0
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
                "avg_commitment_latency_ms": round(avg(entry["commitment_values"]), 1),
                "avg_decision_volatility": round(avg(entry["volatility_values"]), 1),
                "first_choice_accuracy": round(pct(entry["first_choice_correct"], attempts), 1),
                "correction_rate": round(pct(entry["corrected_after_wrong"], attempts), 1),
                "changed_away_from_correct_rate": round(pct(entry["changed_away_from_correct"], attempts), 1),
                "deadline_dependency_rate": round(pct(entry["deadline_dependent"], attempts), 1),
                "total_panic_swaps": entry["panic_total"],
                "students_count": len(entry["participants"]),
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
    events_by_pair: dict[tuple[int, int], list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    events_by_pair = events_by_pair or {}
    for answer in sorted(
        answers,
        key=lambda row: (row["session_id"], question_order.get(row["question_id"], 0), row["id"]),
    ):
        question = question_map.get(answer["question_id"])
        if not question:
            continue
        participant_log = log_by_pair.get((answer["participant_id"], answer["question_id"]))
        participant_events = events_by_pair.get((answer["participant_id"], answer["question_id"]), [])
        decision_path = summarize_decision_path(
            response_ms=answer["response_ms"],
            time_limit_seconds=question["time_limit_seconds"],
            log=participant_log,
        )
        event_overlay = build_event_sequence_overlay(participant_events, answer["response_ms"])
        choice_journey = analyze_choice_journey(answer, question, participant_log)
        stress_index = compute_stress_index(
            avg_tfi_ms=as_float(participant_log.get("tfi_ms")) if participant_log else 0.0,
            avg_swaps=as_float(participant_log.get("total_swaps")) if participant_log else 0.0,
            total_panic_swaps=as_int(participant_log.get("panic_swaps")) if participant_log else 0,
            avg_focus_loss=as_float(participant_log.get("focus_loss_count")) if participant_log else 0.0,
            answers_count=1,
        )
        engagement_score = compute_engagement_score(
            focus_loss_count=as_float(participant_log.get("focus_loss_count")) if participant_log else 0.0,
            idle_time_ms=as_float(participant_log.get("idle_time_ms")) if participant_log else 0.0,
            blur_time_ms=as_float(participant_log.get("blur_time_ms")) if participant_log else 0.0,
            visibility_interruptions=as_float(participant_log.get("visibility_interruptions")) if participant_log else 0.0,
            retry_count=as_float(participant_log.get("submission_retry_count")) if participant_log else 0.0,
            reconnect_count=as_float(participant_log.get("reconnect_count")) if participant_log else 0.0,
            network_degraded=as_bool(participant_log.get("network_degraded")) if participant_log else False,
        )
        path_states = build_path_states(
            path=event_overlay["path"] or decision_path["path"],
            total_swaps=max(
                as_int(participant_log.get("total_swaps")) if participant_log else 0,
                as_int(event_overlay.get("total_swaps")),
            ),
            flip_flops=decision_path["flip_flops"],
            revisit_count=decision_path["revisit_count"],
            focus_loss_count=as_int(participant_log.get("focus_loss_count")) if participant_log else 0,
            deadline_buffer_ms=min(
                decision_path["deadline_buffer_ms"],
                as_int(event_overlay.get("deadline_buffer_ms"), decision_path["deadline_buffer_ms"]),
            ),
            panic_swaps=as_int(participant_log.get("panic_swaps")) if participant_log else 0,
        )
        path_states = list(dict.fromkeys(path_states + [str(state) for state in event_overlay.get("states", [])]))
        path_type = classify_path_type(
            is_correct=answer["is_correct"],
            verification_behavior=(
                choice_journey["verification_behavior"]
                or as_int(event_overlay.get("prompt_reread_count")) > 0
                or as_int(event_overlay.get("media_open_count")) > 0
            ),
            total_swaps=max(
                as_int(participant_log.get("total_swaps")) if participant_log else 0,
                as_int(event_overlay.get("total_swaps")),
            ),
            flip_flops=decision_path["flip_flops"],
            revisit_count=decision_path["revisit_count"],
            distinct_options=max(decision_path["distinct_options"], as_int(event_overlay.get("distinct_options"))),
            deadline_buffer_ms=min(
                decision_path["deadline_buffer_ms"],
                as_int(event_overlay.get("deadline_buffer_ms"), decision_path["deadline_buffer_ms"]),
            ),
            panic_swaps=as_int(participant_log.get("panic_swaps")) if participant_log else 0,
            focus_loss_count=as_int(participant_log.get("focus_loss_count")) if participant_log else 0,
            engagement_score=engagement_score,
            commit_window_ms=max(decision_path["commit_window_ms"], as_int(event_overlay.get("commit_window_ms"))),
        )
        if (
            answer["is_correct"]
            and path_type == "early_lock"
            and (as_int(event_overlay.get("prompt_reread_count")) > 0 or as_int(event_overlay.get("media_open_count")) > 0)
        ):
            path_type = "calm_verification"
        if (
            not answer["is_correct"]
            and path_type != "last_second_collapse"
            and as_int(event_overlay.get("ui_freeze_count")) > 0
            and min(
                decision_path["deadline_buffer_ms"],
                as_int(event_overlay.get("deadline_buffer_ms"), decision_path["deadline_buffer_ms"]),
            ) <= 1500
        ):
            path_type = "last_second_collapse"
        top_contributors = []
        if stress_index >= 55:
            top_contributors.append("stress")
        if engagement_score < 55:
            top_contributors.append("engagement")
        if decision_path["decision_volatility"] >= 45:
            top_contributors.append("volatility")
        if choice_journey["under_time_pressure"]:
            top_contributors.append("deadline_pressure")
        if participant_log and as_int(participant_log.get("focus_loss_count")) > 0:
            top_contributors.append("focus_loss")
        if as_int(event_overlay.get("event_count")) >= 4 and path_type in {"oscillation_loop", "last_second_collapse"}:
            top_contributors.append("event_sequence")

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
                "concept_id": question.get("concept_id") or (question["tags"][0] if question["tags"] else ""),
                "learning_objective": question.get("learning_objective", ""),
                "bloom_level": question.get("bloom_level", ""),
                "stem_length_chars": as_int(question.get("stem_length_chars"), len(question["prompt"])),
                "prompt_complexity_score": as_int(question.get("prompt_complexity_score")),
                "reading_difficulty": question.get("reading_difficulty", ""),
                "media_type": question.get("media_type", "text"),
                "question_position_policy": question.get("question_position_policy", "fixed_pack_order"),
                "is_correct": answer["is_correct"],
                "chosen_index": answer["chosen_index"],
                "correct_index": question["correct_index"],
                "first_choice_index": choice_journey["first_choice_index"],
                "first_choice_label": choice_journey["first_choice_label"],
                "first_choice_text": choice_journey["first_choice_text"],
                "first_choice_correct": choice_journey["first_choice_correct"],
                "final_choice_label": choice_journey["final_choice_label"],
                "final_choice_text": choice_journey["final_choice_text"],
                "changed_answer": choice_journey["changed_answer"],
                "commitment_latency_ms": choice_journey["commitment_latency_ms"],
                "revision_outcome": choice_journey["revision_outcome"],
                "revision_outcome_label": choice_journey["revision_outcome_label"],
                "verification_behavior": choice_journey["verification_behavior"],
                "deadline_dependent": choice_journey["deadline_dependent"],
                "under_time_pressure": choice_journey["under_time_pressure"],
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
                "outside_answer_pointer_moves": as_int(participant_log.get("outside_answer_pointer_moves")) if participant_log else 0,
                "rapid_pointer_jumps": as_int(participant_log.get("rapid_pointer_jumps")) if participant_log else 0,
                "engagement_score": engagement_score,
                "engagement_state": classify_engagement_state(engagement_score),
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
                "path_states": path_states,
                "path_type": path_type,
                "event_count": as_int(event_overlay.get("event_count")),
                "event_path_states": event_overlay.get("states", []),
                "prompt_reread_count": as_int(event_overlay.get("prompt_reread_count")),
                "media_open_count": as_int(event_overlay.get("media_open_count")),
                "ui_freeze_count": as_int(event_overlay.get("ui_freeze_count")),
                "top_contributors": top_contributors[:4],
                "answer_path": event_overlay["path"] or decision_path["path"],
            }
        )
    return rows


def build_normalized_feature(value: float, population: list[float]) -> dict[str, float]:
    if not population:
        return {"raw": round(value, 3), "percentile": 0.0, "z_score": 0.0}
    mean = avg(population)
    deviation = stddev(population)
    percentile_rank = pct(sum(1 for item in population if item <= value), len(population))
    z_score = 0.0 if deviation == 0 else (value - mean) / deviation
    return {
        "raw": round(value, 3),
        "percentile": round(percentile_rank, 1),
        "z_score": round(z_score, 3),
    }


def attach_normalized_features(question_review: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not question_review:
        return question_review

    feature_sets = {
        "response_ms": [as_float(row.get("response_ms")) for row in question_review],
        "tfi_ms": [as_float(row.get("tfi_ms")) for row in question_review],
        "total_swaps": [as_float(row.get("total_swaps")) for row in question_review],
        "stress_index": [as_float(row.get("stress_index")) for row in question_review],
        "engagement_score": [as_float(row.get("engagement_score")) for row in question_review],
    }

    for row in question_review:
        row["normalized_features"] = {
            feature_id: build_normalized_feature(as_float(row.get(feature_id)), values)
            for feature_id, values in feature_sets.items()
        }
    return question_review


def build_behavior_signals(
    answers: list[dict[str, Any]],
    question_review: list[dict[str, Any]],
    focus_score: float,
    evidence_count: int | None = None,
) -> list[dict[str, Any]]:
    if not answers:
        return []
    evidence_count = evidence_count if evidence_count is not None else len(question_review)

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
    engagement_index = round(avg([as_float(row.get("engagement_score")) for row in question_review]), 1)
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

    sensitive_thresholds = {
        "recovery_index": 5,
        "confidence_alignment": 5,
        "consistency": 5,
    }

    signals = [
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
            "id": "engagement_score",
            "label": "Engagement",
            "score": engagement_index,
            "caption": "How consistently the learner stayed on-task and interaction-ready during the session.",
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
    for signal in signals:
        minimum_evidence = sensitive_thresholds.get(signal["id"], 0)
        suppressed = evidence_count < minimum_evidence
        signal["minimum_evidence"] = minimum_evidence
        signal["suppressed"] = suppressed
        signal["suppressed_reason"] = (
            f"Needs at least {minimum_evidence} answered questions to avoid a noisy read."
            if suppressed and minimum_evidence > 0
            else None
        )
    return signals


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


def build_mastery_snapshot(
    question_review: list[dict[str, Any]],
    mastery_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not question_review and not mastery_rows:
        return []

    mastery_lookup = {
        str(row.get("tag", "")).strip().lower(): as_float(row.get("score"))
        for row in mastery_rows
        if str(row.get("tag", "")).strip()
    }
    grouped_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in question_review:
        concept_id = str(row.get("concept_id") or "").strip().lower() or "general"
        grouped_rows[concept_id].append(row)

    snapshot: list[dict[str, Any]] = []
    for concept_id, rows in grouped_rows.items():
        accuracy = round(pct(sum(1 for row in rows if as_bool(row.get("is_correct"))), len(rows)), 1)
        avg_stress = round(avg([as_float(row.get("stress_index")) for row in rows]), 1)
        avg_engagement = round(avg([as_float(row.get("engagement_score")) for row in rows]), 1)
        prior_mastery = mastery_lookup.get(concept_id, mastery_lookup.get(str(rows[0].get("learning_objective", "")).strip().lower(), 0.0))
        mastery_score = round(
            clamp((prior_mastery * 0.55) + (accuracy * 0.45) - max(0.0, avg_stress - 55.0) * 0.2, 0.0, 100.0),
            1,
        )
        if mastery_score >= 78 and accuracy >= 75:
            state = "secure"
        elif mastery_score >= 55:
            state = "growing"
        else:
            state = "fragile"
        snapshot.append(
            {
                "concept_id": concept_id,
                "learning_objective": str(rows[0].get("learning_objective", "")).strip(),
                "attempts": len(rows),
                "accuracy": accuracy,
                "avg_stress": avg_stress,
                "avg_engagement": avg_engagement,
                "prior_mastery": round(prior_mastery, 1),
                "mastery_score": mastery_score,
                "mastery_state": state,
            }
        )

    snapshot.sort(key=lambda row: (row["mastery_score"], row["concept_id"]))
    return snapshot


def build_model_predictions(
    *,
    accuracy: float,
    stress_index: float,
    focus_score: float,
    question_review: list[dict[str, Any]],
    mastery_snapshot: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    fragile_concepts = [row for row in mastery_snapshot if row["mastery_state"] == "fragile"]
    distractor_rate = pct(
        sum(1 for row in question_review if row.get("path_type") == "last_second_collapse" or row.get("revision_outcome") == "correct_to_incorrect"),
        len(question_review),
    )
    pressure_breakdown = round(
        clamp(
            (stress_index * 0.55)
            + max(0.0, 70.0 - accuracy) * 0.8
            + max(0.0, 62.0 - focus_score) * 0.45,
            0.0,
            100.0,
        ),
        1,
    )
    future_wrong_next = round(
        clamp(
            max(0.0, 72.0 - accuracy) * 0.55
            + max(0.0, stress_index - 35.0) * 0.5
            + pct(sum(1 for row in question_review if row.get("status") == "shaky"), len(question_review)) * 0.35,
            0.0,
            100.0,
        ),
        1,
    )
    needs_reteach = round(
        clamp(
            max(0.0, 68.0 - accuracy) * 0.75
            + len(fragile_concepts) * 8.0
            + max(0.0, stress_index - 45.0) * 0.25,
            0.0,
            100.0,
        ),
        1,
    )
    likely_distractor_issue = round(clamp(distractor_rate * 1.2, 0.0, 100.0), 1)

    if needs_reteach >= 65:
        recommended_action = "reteach"
    elif pressure_breakdown >= 60:
        recommended_action = "slow_down"
    elif likely_distractor_issue >= 45:
        recommended_action = "reduce_distractors"
    else:
        recommended_action = "keep_momentum"

    return [
        {
            "id": "future_wrong_next",
            "score": future_wrong_next,
            "state": "high" if future_wrong_next >= 70 else "medium" if future_wrong_next >= 45 else "low",
            "recommended_action": recommended_action,
            "top_contributors": ["accuracy", "stress", "shaky_correct"][:3],
        },
        {
            "id": "needs_reteach",
            "score": needs_reteach,
            "state": "high" if needs_reteach >= 70 else "medium" if needs_reteach >= 45 else "low",
            "recommended_action": "reteach" if needs_reteach >= 55 else recommended_action,
            "top_contributors": ["fragile_concepts", "accuracy", "stress"][:3],
        },
        {
            "id": "likely_distractor_issue",
            "score": likely_distractor_issue,
            "state": "high" if likely_distractor_issue >= 60 else "medium" if likely_distractor_issue >= 35 else "low",
            "recommended_action": "reduce_distractors" if likely_distractor_issue >= 35 else recommended_action,
            "top_contributors": ["revision_outcomes", "path_type", "volatility"][:3],
        },
        {
            "id": "performance_breakdown_under_pressure",
            "score": pressure_breakdown,
            "state": "high" if pressure_breakdown >= 65 else "medium" if pressure_breakdown >= 40 else "low",
            "recommended_action": "slow_down" if pressure_breakdown >= 40 else recommended_action,
            "top_contributors": ["stress", "focus", "deadline_pressure"][:3],
        },
    ]


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
    raw_time_limit_seconds = as_int(payload.get("time_limit_seconds"), 20)
    time_limit_seconds = max(5, raw_time_limit_seconds) if raw_time_limit_seconds > 0 else 20
    scoring_profile = str(payload.get("scoring_profile", "standard")).strip().lower() or "standard"
    tags = parse_string_list(payload.get("tags"))
    mastery_map = build_mastery_map(payload.get("current_mastery"))
    computed_speed = speed_factor(response_ms, time_limit_seconds)

    score_awarded = 0
    if mode == "session" and is_correct:
        if scoring_profile == "accuracy":
            score_awarded = 1200
        else:
            score_awarded = 1000 + round(computed_speed * 1000)

    if mode == "practice":
        correct_gain = 5.0 + (computed_speed * 5.0)
        incorrect_penalty = -5.0
    elif scoring_profile == "accuracy":
        correct_gain = 12.0
        incorrect_penalty = -12.0
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
        "scoring_profile": scoring_profile,
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
    behavior_events = [normalize_behavior_event(event) for event in payload.get("behavior_events", [])]

    question_map = {question["id"]: question for question in questions}
    question_order = {question["id"]: index + 1 for index, question in enumerate(questions)}
    answers_by_participant: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_question: dict[int, list[dict[str, Any]]] = defaultdict(list)
    logs_by_pair: dict[tuple[int, int], dict[str, Any]] = {}
    events_by_pair = build_behavior_event_lookup(behavior_events)

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
        total_submission_retries = sum(log["submission_retry_count"] for log in participant_logs)
        total_reconnects = sum(log["reconnect_count"] for log in participant_logs)
        total_visibility_interruptions = sum(log["visibility_interruptions"] for log in participant_logs)
        total_network_degraded = sum(1 for log in participant_logs if log["network_degraded"])
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
        participant_question_review = build_question_review_rows(
            answers=participant_answers,
            question_map=question_map,
            question_order=question_order,
            log_by_pair=logs_by_pair,
            events_by_pair=events_by_pair,
        )
        profile = build_student_profile(
            answers=participant_answers,
            logs=participant_logs,
            mastery_rows=[{"tag": row["tag"], "score": row["score"]} for row in session_tag_rows],
        )
        participant_behavior_signals = build_behavior_signals(
            answers=participant_answers,
            question_review=participant_question_review,
            focus_score=profile["focus_score"],
        )
        revision_summary = build_revision_summary(participant_question_review)
        deadline_profile = build_deadline_profile(participant_question_review)
        recovery_profile = build_recovery_profile(participant_question_review)
        fatigue_drift = build_fatigue_drift(participant_question_review)
        misconception_patterns = build_misconception_patterns(participant_question_review)
        stability_score = extract_signal_score(participant_behavior_signals, "consistency")
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
        data_quality = build_data_quality(
            expected_count=len(questions),
            observed_count=answers_count,
            reconnect_count=total_reconnects,
            retry_count=total_submission_retries,
            visibility_interruptions=total_visibility_interruptions,
            network_degraded_count=total_network_degraded,
        )
        student_action = select_student_action(
            accuracy=accuracy,
            stress_index=stress_index,
            focus_score=profile["focus_score"],
            changed_away_from_correct_count=revision_summary["changed_away_from_correct_count"],
            deadline_dependency_rate=deadline_profile["last_second_rate"],
            weak_tags=profile["weak_tags"],
        )
        trust_bundle = build_trust_bundle(
            evidence_count=answers_count,
            observed_headline="Observed facts",
            observed_body=(
                f"{accuracy:.1f}% accuracy across {answers_count} captured answers, "
                f"{stress_index:.1f} stress, and {total_focus_loss} focus-loss events."
            ),
            interpretation_headline=profile["headline"],
            interpretation_body=profile["body"],
            teacher_action=student_action,
            raw_facts=[
                build_metric("Accuracy", accuracy, "%"),
                build_metric("Correct answers", correct_answers),
                build_metric("Captured answers", answers_count),
                build_metric("Stress index", stress_index, "%"),
                build_metric("Focus losses", total_focus_loss),
                build_metric("Submission retries", total_submission_retries),
                build_metric("Reconnects", total_reconnects),
                build_metric("Visibility interruptions", total_visibility_interruptions),
            ],
            grading_safe_metrics=[
                build_metric("Accuracy", accuracy, "%"),
                build_metric("Correct answers", correct_answers),
                build_metric("Captured answers", answers_count),
                build_metric("First-choice accuracy", revision_summary["first_choice_correct_rate"], "%"),
            ],
            behavior_signal_metrics=[
                build_metric("Stress index", stress_index, "%"),
                build_metric("Focus score", profile["focus_score"]),
                build_metric("Confidence score", profile["confidence_score"]),
                build_metric("Panic swaps", total_panic_swaps),
                build_metric("Attention drag", attention_drag_index),
            ],
            data_quality=data_quality,
        )
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
                "avg_commitment_latency_ms": round(
                    avg([row["commitment_latency_ms"] for row in participant_question_review]),
                    1,
                ),
                "first_choice_accuracy": revision_summary["first_choice_correct_rate"],
                "corrected_answers": revision_summary["corrected_after_wrong_count"],
                "changed_away_from_correct": revision_summary["changed_away_from_correct_count"],
                "deadline_dependency_rate": deadline_profile["last_second_rate"],
                "recovery_rate": recovery_profile["recovery_rate"],
                "stability_score": stability_score,
                "total_swaps": total_swaps,
                "total_panic_swaps": total_panic_swaps,
                "total_focus_loss": total_focus_loss,
                "total_pointer_activity": total_pointer_activity,
                "total_keyboard_activity": total_keyboard_activity,
                "total_touch_activity": total_touch_activity,
                "total_same_answer_reclicks": total_same_answer_reclicks,
                "total_submission_retries": total_submission_retries,
                "total_reconnects": total_reconnects,
                "total_visibility_interruptions": total_visibility_interruptions,
                "total_network_degraded_events": total_network_degraded,
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
                "revision_summary": revision_summary,
                "deadline_profile": deadline_profile,
                "recovery_profile": recovery_profile,
                "fatigue_drift": fatigue_drift,
                "misconception_patterns": misconception_patterns,
                "risk_score": risk_score,
                "risk_level": risk_level,
                "flags": flags,
                "recommendation": build_student_recommendation(
                    accuracy=accuracy,
                    stress_index=stress_index,
                    focus_score=profile["focus_score"],
                    weak_tags=profile["weak_tags"],
                ),
                **trust_bundle,
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
        question_review_rows = []
        choice_counts: Counter[int] = Counter()
        for answer in question_answers:
            related_log = logs_by_pair.get((answer["participant_id"], question["id"]))
            choice_journey = analyze_choice_journey(answer, question, related_log)
            decision_path = summarize_decision_path(
                response_ms=answer["response_ms"],
                time_limit_seconds=question["time_limit_seconds"],
                log=related_log,
            )
            choice_counts[answer["chosen_index"]] += 1
            question_review_rows.append(
                {
                    "question_id": question["id"],
                    "question_index": question_order.get(question["id"], 0),
                    "participant_id": answer["participant_id"],
                    "is_correct": answer["is_correct"],
                    "deadline_buffer_ms": decision_path["deadline_buffer_ms"],
                    "first_choice_correct": choice_journey["first_choice_correct"],
                    "commitment_latency_ms": choice_journey["commitment_latency_ms"],
                    "revision_outcome": choice_journey["revision_outcome"],
                    "under_time_pressure": choice_journey["under_time_pressure"],
                }
            )

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
        revision_summary = build_revision_summary(question_review_rows)
        deadline_profile = build_deadline_profile(question_review_rows)
        choice_distribution = [
            {
                "index": index,
                "label": option_label(index),
                "text": option_text(question, index),
                "count": choice_counts.get(index, 0),
                "rate": round(pct(choice_counts.get(index, 0), len(question_answers)), 1),
                "is_correct": index == question["correct_index"],
            }
            for index in range(len(question["answers"]))
        ]
        distractor_options = [
            item for item in choice_distribution if not item["is_correct"] and item["count"] > 0
        ]
        top_distractor = max(distractor_options, key=lambda item: item["count"], default=None)
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
            "avg_commitment_latency_ms": round(
                avg([row["commitment_latency_ms"] for row in question_review_rows]),
                1,
            ),
            "first_choice_accuracy": revision_summary["first_choice_correct_rate"],
            "corrected_after_wrong_count": revision_summary["corrected_after_wrong_count"],
            "corrected_after_wrong_rate": revision_summary["corrected_after_wrong_rate"],
            "changed_away_from_correct_count": revision_summary["changed_away_from_correct_count"],
            "changed_away_from_correct_rate": revision_summary["changed_away_from_correct_rate"],
            "deadline_dependency_rate": deadline_profile["last_second_rate"],
            "choice_distribution": choice_distribution,
            "top_distractor": top_distractor,
            "stress_index": stress_index,
            "stress_level": classify_stress(stress_index),
            "tags": question["tags"],
            "missed_by_count": len(question_answers) - correct_answers,
        }
        question_row["recommendation"] = build_question_recommendation(question_row)
        question_data_quality = build_data_quality(
            expected_count=len(participants),
            observed_count=len(question_answers),
            reconnect_count=sum(log["reconnect_count"] for log in question_logs),
            retry_count=sum(log["submission_retry_count"] for log in question_logs),
            visibility_interruptions=sum(log["visibility_interruptions"] for log in question_logs),
            network_degraded_count=sum(1 for log in question_logs if log["network_degraded"]),
        )
        question_action = select_question_action(question_row)
        question_row.update(
            build_trust_bundle(
                evidence_count=len(question_answers),
                observed_headline="Observed facts",
                observed_body=(
                    f"Question {question_row['index']} landed at {accuracy:.1f}% accuracy from {len(question_answers)} answers, "
                    f"with {stress_index:.1f} stress and "
                    f"{(top_distractor or {}).get('rate', 0):.1f}% on the top distractor."
                ),
                interpretation_headline=question_row["recommendation"],
                interpretation_body=(
                    "This interpretation blends the accuracy pattern with pressure, revision, and distractor behavior on the item."
                ),
                teacher_action=question_action,
                raw_facts=[
                    build_metric("Accuracy", accuracy, "%"),
                    build_metric("Answers captured", len(question_answers)),
                    build_metric("Stress index", stress_index, "%"),
                    build_metric("First-choice accuracy", revision_summary["first_choice_correct_rate"], "%"),
                    build_metric("Deadline dependency", deadline_profile["last_second_rate"], "%"),
                    build_metric("Top distractor rate", (top_distractor or {}).get("rate", 0), "%"),
                ],
                grading_safe_metrics=[
                    build_metric("Accuracy", accuracy, "%"),
                    build_metric("Correct answers", correct_answers),
                    build_metric("Answers captured", len(question_answers)),
                ],
                behavior_signal_metrics=[
                    build_metric("Stress index", stress_index, "%"),
                    build_metric("Avg response", avg_response_ms, "ms"),
                    build_metric("Avg swaps", avg_swaps),
                    build_metric("Panic swaps", total_panic_swaps),
                ],
                data_quality=question_data_quality,
            )
        )
        question_rows.append(question_row)

    tag_summary = build_tag_rows_for_answers(
        answers=answers,
        question_map=question_map,
        logs_by_pair=logs_by_pair,
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
    total_reconnects = sum(log["reconnect_count"] for log in logs)
    total_submission_retries = sum(log["submission_retry_count"] for log in logs)
    total_visibility_interruptions = sum(log["visibility_interruptions"] for log in logs)
    total_network_degraded = sum(1 for log in logs if log["network_degraded"])
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
    revision_intelligence = build_revision_summary(research_rows)
    deadline_dependency = build_deadline_profile(research_rows)
    recovery_profile = combine_recovery_profiles(
        [row.get("recovery_profile", {}) for row in participant_rows]
    )
    fatigue_drift = build_fatigue_drift(research_rows)
    recurrent_misconceptions = build_misconception_patterns(research_rows)
    class_data_quality = build_data_quality(
        expected_count=participant_count * question_count,
        observed_count=total_answers,
        reconnect_count=total_reconnects,
        retry_count=total_submission_retries,
        visibility_interruptions=total_visibility_interruptions,
        network_degraded_count=total_network_degraded,
    )
    class_action = select_class_action(
        overall_accuracy=overall_accuracy,
        stress_index=stress_index,
        first_choice_accuracy=revision_intelligence["first_choice_correct_rate"],
        focus_watch_count=focus_watch_count,
        participant_count=participant_count,
        top_distractor_rate=as_float((toughest_question.get("top_distractor") or {}).get("rate")) if toughest_question else 0.0,
    )
    class_trust_bundle = build_trust_bundle(
        evidence_count=total_answers,
        observed_headline="Observed facts",
        observed_body=(
            f"{overall_accuracy:.1f}% class accuracy across {total_answers} answers, "
            f"{completion_rate:.1f}% completion, and {stress_index:.1f} stress."
        ),
        interpretation_headline=headline,
        interpretation_body=summary,
        teacher_action=class_action,
        raw_facts=[
            build_metric("Class accuracy", overall_accuracy, "%"),
            build_metric("Completion rate", completion_rate, "%"),
            build_metric("Participants", participant_count),
            build_metric("Questions", question_count),
            build_metric("Focus losses", total_focus_loss),
            build_metric("Panic swaps", total_panic_swaps),
            build_metric("Reconnects", total_reconnects),
            build_metric("Submission retries", total_submission_retries),
        ],
        grading_safe_metrics=[
            build_metric("Class accuracy", overall_accuracy, "%"),
            build_metric("Completion rate", completion_rate, "%"),
            build_metric("Participants", participant_count),
            build_metric("Questions", question_count),
            build_metric("First-choice accuracy", revision_intelligence["first_choice_correct_rate"], "%"),
        ],
        behavior_signal_metrics=[
            build_metric("Stress index", stress_index, "%"),
            build_metric("Focus watch students", focus_watch_count),
            build_metric("High-risk students", high_risk_count),
            build_metric("Panic swaps", total_panic_swaps),
        ],
        data_quality=class_data_quality,
    )
    correlations = build_class_correlations(participant_rows)
    student_clusters = build_student_clusters(participant_rows)
    question_diagnostics = build_question_diagnostics(
        question_rows=question_rows,
        answers_by_question=answers_by_question,
        participant_rows=participant_rows,
    )
    question_lookup = {row["id"]: row for row in question_rows}
    alerts = [
        {
            **alert,
            **build_trust_bundle(
                evidence_count=as_int((question_lookup.get(as_int(alert.get("question_id"))) or {}).get("answers_count"), participant_count),
                observed_headline="Observed facts",
                observed_body=alert["body"],
                interpretation_headline=alert["title"],
                interpretation_body="This alert is raised only when the underlying evidence crosses the session threshold for that pattern.",
                teacher_action=(question_lookup.get(as_int(alert.get("question_id"))) or {}).get("teacher_action") or class_action,
                raw_facts=(
                    (question_lookup.get(as_int(alert.get("question_id"))) or {}).get("raw_facts")
                    or class_trust_bundle["raw_facts"]
                ),
                grading_safe_metrics=class_trust_bundle["grading_safe_metrics"],
                behavior_signal_metrics=class_trust_bundle["behavior_signal_metrics"],
                data_quality=(
                    (question_lookup.get(as_int(alert.get("question_id"))) or {}).get("data_quality")
                    or class_data_quality
                ),
            ),
        }
        for alert in alerts
    ]
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
                "id": "first_choice_accuracy",
                "label": "First-choice correctness",
                "unit": "%",
                "summary": build_stat_summary([row["first_choice_accuracy"] for row in participant_rows]),
            },
            {
                "id": "avg_commitment_latency_ms",
                "label": "Commitment latency",
                "unit": "ms",
                "summary": build_stat_summary([row["avg_commitment_latency_ms"] for row in participant_rows]),
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
            "revision_intelligence": revision_intelligence,
            "deadline_dependency": deadline_dependency,
            "recovery_profile": recovery_profile,
            "fatigue_drift": fatigue_drift,
            "recurrent_misconceptions": recurrent_misconceptions,
        "topic_behavior_profiles": tag_summary,
    }
    summary_payload = {
        "session_id": as_int(session.get("id")),
        "overall_accuracy": overall_accuracy,
        "participant_count": participant_count,
        "question_count": question_count,
        "completion_rate": completion_rate,
        "stress_index": stress_index,
        "total_answers": total_answers,
        "first_choice_accuracy": revision_intelligence["first_choice_correct_rate"],
        "corrected_after_wrong_count": revision_intelligence["corrected_after_wrong_count"],
        "changed_away_from_correct_count": revision_intelligence["changed_away_from_correct_count"],
        "deadline_dependency_rate": deadline_dependency["last_second_rate"],
        "total_focus_loss": total_focus_loss,
        "total_panic_swaps": total_panic_swaps,
        "total_reconnects": total_reconnects,
        "total_submission_retries": total_submission_retries,
        "total_visibility_interruptions": total_visibility_interruptions,
        "high_risk_students": high_risk_count,
        "medium_risk_students": medium_risk_count,
        "focus_watch_students": focus_watch_count,
        "team_count": len(team_rows),
        "headline": headline,
        "summary": summary,
        "toughest_question_id": toughest_question["id"] if toughest_question else None,
        "top_gap_tag": tag_summary[0]["tag"] if tag_summary else None,
        **class_trust_bundle,
    }

    return {
        "analytics_version": ANALYTICS_VERSION,
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
        "summary": summary_payload,
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
    avg_swaps = round(total_swaps / max(1, len(answers)), 2)
    avg_panic_swaps = round(total_panic_swaps / max(1, len(answers)), 2)
    avg_focus_loss = round(total_focus_loss / max(1, len(answers)), 2)
    confidence = compute_confidence_score(
        accuracy=accuracy,
        avg_tfi_ms=avg_tfi_ms,
        avg_swaps=avg_swaps,
        total_panic_swaps=avg_panic_swaps,
        total_focus_loss=avg_focus_loss,
        avg_blur_time_ms=avg_blur_time_ms,
    )
    if accuracy > 80 and total_swaps <= len(answers):
        confidence = round(clamp(confidence + 5.0, 0.0, 100.0))

    focus_score = compute_focus_score(
        total_focus_loss=total_focus_loss,
        avg_idle_time_ms=avg_idle_time_ms,
        avg_blur_time_ms=avg_blur_time_ms,
    )
    confidence_contributors = build_confidence_contributors(
        accuracy=accuracy,
        avg_tfi_ms=avg_tfi_ms,
        avg_swaps=avg_swaps,
        total_panic_swaps=avg_panic_swaps,
        total_focus_loss=avg_focus_loss,
        avg_blur_time_ms=avg_blur_time_ms,
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
        "confidence_metadata": {
            "contributors": confidence_contributors,
            "analytics_version": ANALYTICS_VERSION,
        },
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
    behavior_events = [normalize_behavior_event(event) for event in payload.get("behavior_events", [])]
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
    concept_attempt_history = [dict(entry) for entry in payload.get("concept_attempt_history", []) if isinstance(entry, dict)]
    analytics_labels = [dict(entry) for entry in payload.get("analytics_labels", []) if isinstance(entry, dict)]

    question_map = {question["id"]: question for question in questions}
    question_order = {question["id"]: index + 1 for index, question in enumerate(questions)}
    log_by_pair = {(log["participant_id"], log["question_id"]): log for log in logs}
    events_by_pair = build_behavior_event_lookup(behavior_events)
    logs_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    events_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for answer in answers:
        answers_by_session[answer["session_id"]].append(answer)
    for log in logs:
        logs_by_session[log["session_id"]].append(log)
    for event in behavior_events:
        events_by_session[as_int(event.get("session_id"))].append(event)

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
        "total_submission_retries": sum(log["submission_retry_count"] for log in logs),
        "total_reconnects": sum(log["reconnect_count"] for log in logs),
        "total_visibility_interruptions": sum(log["visibility_interruptions"] for log in logs),
        "total_network_degraded_events": sum(1 for log in logs if log["network_degraded"]),
        "avg_idle_time_ms": round(avg([log["idle_time_ms"] for log in logs]), 1),
        "avg_blur_time_ms": round(avg([log["blur_time_ms"] for log in logs]), 1),
        "avg_longest_idle_streak_ms": round(avg([log["longest_idle_streak_ms"] for log in logs]), 1),
        "pointer_activity_total": sum(log["pointer_activity_count"] for log in logs),
        "keyboard_activity_total": sum(log["keyboard_activity_count"] for log in logs),
        "touch_activity_total": sum(log["touch_activity_count"] for log in logs),
        "same_answer_reclicks": sum(log["same_answer_reclicks"] for log in logs),
        "avg_hover_entropy": round(avg([log["hover_entropy"] for log in logs]), 3),
    }

    tag_performance = build_tag_rows_for_answers(
        answers=answers,
        question_map=question_map,
        logs_by_pair=log_by_pair,
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

    question_review = attach_normalized_features(build_question_review_rows(
        answers=answers,
        question_map=question_map,
        question_order=question_order,
        log_by_pair=log_by_pair,
        events_by_pair=events_by_pair,
    ))
    behavior_signals = build_behavior_signals(
        answers=answers,
        question_review=question_review,
        focus_score=profile["focus_score"],
        evidence_count=stats["total_answers"],
    )
    signal_suppressed_metrics = [signal["id"] for signal in behavior_signals if signal.get("suppressed")]
    avg_engagement_score = round(avg([as_float(row.get("engagement_score")) for row in question_review]), 1)
    engagement_state = classify_engagement_state(avg_engagement_score)
    momentum = build_momentum_summary(question_review)
    session_segments = build_session_segments(question_review)
    revision_summary = build_revision_summary(question_review)
    deadline_profile = build_deadline_profile(question_review)
    recovery_profile = build_recovery_profile(question_review)
    fatigue_drift = build_fatigue_drift(question_review)
    misconception_patterns = build_misconception_patterns(question_review)
    mastery_snapshot = build_mastery_snapshot(question_review, mastery_rows)
    model_predictions = build_model_predictions(
        accuracy=stats["accuracy"],
        stress_index=session_stress,
        focus_score=profile["focus_score"],
        question_review=question_review,
        mastery_snapshot=mastery_snapshot,
    )
    intervention_model = max(model_predictions, key=lambda row: as_float(row.get("score")), default=None)
    stability_score = extract_signal_score(behavior_signals, "consistency")

    aggregates.update(
        {
            "avg_commitment_latency_ms": round(
                avg([row["commitment_latency_ms"] for row in question_review]),
                1,
            ),
            "first_choice_accuracy": revision_summary["first_choice_correct_rate"],
            "deadline_dependency_rate": deadline_profile["last_second_rate"],
            "stability_score": stability_score,
        }
    )

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
    if revision_summary["changed_away_from_correct_count"] > 0:
        highlights.append(
            {
                "title": "Revision risk",
                "body": "At least one question began correctly and ended wrong. This is a confidence-and-commitment issue, not pure content weakness.",
            }
        )
    if fatigue_drift["direction"] == "fatigue" and stats["total_answers"] >= 5:
        highlights.append(
            {
                "title": "Fatigue drift",
                "body": "The back half of the game was weaker than the opening, so shorter follow-ups may outperform longer mixed sets.",
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
    if deadline_profile["last_second_rate"] >= 30:
        recommendations.append(
            {
                "title": "Reduce deadline dependency",
                "body": "A large share of decisions landed in the final second. Re-run the same concepts with calmer pacing or explicit commitment prompts.",
            }
        )
    if stats["total_answers"] >= 5 and recovery_profile["total_followups"] > 0 and recovery_profile["recovery_rate"] < 50:
        recommendations.append(
            {
                "title": "Coach recovery after misses",
                "body": "After an error, the next question often stays unstable. A short reteach loop right after mistakes should help.",
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
        session_events = events_by_session.get(session_id, [])
        session_events_by_pair = build_behavior_event_lookup(session_events)
        session_review = build_question_review_rows(
            answers=session_answers,
            question_map=question_map,
            question_order=question_order,
            log_by_pair=session_log_by_pair,
            events_by_pair=session_events_by_pair,
        )
        session_revision_summary = build_revision_summary(session_review)
        session_deadline_profile = build_deadline_profile(session_review)
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
                "avg_commitment_latency_ms": round(
                    avg([row["commitment_latency_ms"] for row in session_review]),
                    1,
                ),
                "first_choice_accuracy": session_revision_summary["first_choice_correct_rate"],
                "deadline_dependency_rate": session_deadline_profile["last_second_rate"],
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
    student_data_quality = build_data_quality(
        expected_count=len(questions),
        observed_count=stats["total_answers"],
        reconnect_count=aggregates["total_reconnects"],
        retry_count=aggregates["total_submission_retries"],
        visibility_interruptions=aggregates["total_visibility_interruptions"],
        network_degraded_count=aggregates["total_network_degraded_events"],
    )
    student_action = select_student_action(
        accuracy=stats["accuracy"],
        stress_index=session_stress,
        focus_score=profile["focus_score"],
        changed_away_from_correct_count=revision_summary["changed_away_from_correct_count"],
        deadline_dependency_rate=deadline_profile["last_second_rate"],
        weak_tags=profile["weak_tags"],
    )
    student_trust_bundle = build_trust_bundle(
        evidence_count=stats["total_answers"],
        observed_headline="Observed facts",
        observed_body=(
            f"{stats['accuracy']:.1f}% accuracy across {stats['total_answers']} captured answers, "
            f"{session_stress:.1f} stress, and {aggregates['total_focus_loss']} focus-loss events."
        ),
        interpretation_headline=overall_story["headline"],
        interpretation_body=overall_story["body"],
        teacher_action=student_action,
        raw_facts=[
            build_metric("Accuracy", stats["accuracy"], "%"),
            build_metric("Captured answers", stats["total_answers"]),
            build_metric("Stress index", session_stress, "%"),
            build_metric("Focus losses", aggregates["total_focus_loss"]),
            build_metric("Submission retries", aggregates["total_submission_retries"]),
            build_metric("Reconnects", aggregates["total_reconnects"]),
            build_metric("Weak tags", ", ".join(profile["weak_tags"][:2])),
        ],
        grading_safe_metrics=[
            build_metric("Accuracy", stats["accuracy"], "%"),
            build_metric("Total answers", stats["total_answers"]),
            build_metric("Total score", stats["total_score"]),
            build_metric("First-choice accuracy", revision_summary["first_choice_correct_rate"], "%"),
        ],
        behavior_signal_metrics=[
            build_metric("Stress index", session_stress, "%"),
            build_metric("Focus score", profile["focus_score"]),
            build_metric("Confidence score", profile["confidence_score"]),
            build_metric("Engagement score", avg([as_float(row.get("engagement_score")) for row in question_review]), "%"),
            build_metric("Panic swaps", aggregates["total_panic_swaps"]),
            build_metric("Deadline dependency", deadline_profile["last_second_rate"], "%"),
        ],
        data_quality=student_data_quality,
    )
    sensitive_signal_enabled = stats["total_answers"] >= 5 and student_trust_bundle["confidence_band"] != "low"
    if not sensitive_signal_enabled:
        suppression_reason = student_trust_bundle["suppressed_reason"] or "More clean observations are needed before recovery and drift calls are safe."
        recovery_profile = {
            **recovery_profile,
            "suppressed": True,
            "suppressed_reason": suppression_reason,
        }
        fatigue_drift = {
            **fatigue_drift,
            "suppressed": True,
            "suppressed_reason": suppression_reason,
        }
        recommendations = [
            item for item in recommendations
            if item["title"] not in {"Coach recovery after misses"}
        ]
        highlights = [
            item for item in highlights
            if item["title"] not in {"Fatigue drift"}
        ]
    behavior_signals = [
        {
            **signal,
            "suppressed": (
                signal.get("suppressed")
                or (
                    not sensitive_signal_enabled
                    and signal["id"] in {"recovery_index", "confidence_alignment", "consistency"}
                )
            ),
            "suppressed_reason": (
                signal.get("suppressed_reason")
                or (
                    student_trust_bundle["suppressed_reason"]
                    if (
                        not sensitive_signal_enabled
                        and signal["id"] in {"recovery_index", "confidence_alignment", "consistency"}
                    )
                    else None
                )
            ),
        }
        for signal in behavior_signals
    ]
    signal_suppressed_metrics = [signal["id"] for signal in behavior_signals if signal.get("suppressed")]
    overall_story = {
        **overall_story,
        **student_trust_bundle,
    }
    practice_plan = {
        **practice_plan,
        "teacher_action": student_action,
        "analytics_version": ANALYTICS_VERSION,
    }

    return {
        "analytics_version": ANALYTICS_VERSION,
        "trust": student_trust_bundle,
        "dataQuality": student_data_quality,
        "gradingSafeMetrics": student_trust_bundle["grading_safe_metrics"],
        "behaviorSignalMetrics": student_trust_bundle["behavior_signal_metrics"],
        "stats": stats,
        "mastery": mastery_rows,
        "masteryState": mastery_snapshot,
        "aggregates": aggregates,
        "profile": profile,
        "engagementModel": {
            "score": avg_engagement_score,
            "state": engagement_state,
        },
        "risk": {
            "score": risk_score,
            "level": risk_level,
            "stress_index": session_stress,
            "signal_quality": student_trust_bundle["signal_quality"],
            "confidence_band": student_trust_bundle["confidence_band"],
            "evidence_count": student_trust_bundle["evidence_count"],
            "suppressed_reason": student_trust_bundle["suppressed_reason"],
            "teacher_action": student_action,
            "raw_facts": student_trust_bundle["raw_facts"],
        },
        "tagPerformance": tag_performance,
        "questionReview": question_review,
        "behaviorSignals": behavior_signals,
        "signalSuppressedMetrics": signal_suppressed_metrics,
        "modelPredictions": model_predictions,
        "interventionModel": intervention_model,
        "labels": analytics_labels[:24],
        "conceptAttemptHistory": concept_attempt_history[:50],
        "stabilityScore": stability_score,
        "revisionInsights": revision_summary,
        "deadlineProfile": deadline_profile,
        "recoveryProfile": recovery_profile,
        "fatigueDrift": fatigue_drift,
        "misconceptionPatterns": misconception_patterns,
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
    behavior_events = [normalize_behavior_event(event) for event in payload.get("behavior_events", [])]

    participants_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    answers_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    logs_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    events_by_session: dict[int, list[dict[str, Any]]] = defaultdict(list)
    questions_by_pack: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for participant in participants:
        participants_by_session[as_int(participant.get("session_id"))].append(participant)
    for answer in answers:
        answers_by_session[answer["session_id"]].append(answer)
    for log in logs:
        logs_by_session[log["session_id"]].append(log)
    for event in behavior_events:
        events_by_session[as_int(event.get("session_id"))].append(event)
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
                "behavior_events": events_by_session.get(session_id, []),
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

    overview_headline = (
        "Recent sessions look instructionally stable."
        if avg_accuracy >= 80 and avg_stress < 35
        else "Recent sessions show a mixed teaching picture."
        if avg_accuracy >= 60
        else "Recent sessions need a stronger reteach loop."
    )
    overview_action = select_class_action(
        overall_accuracy=avg_accuracy,
        stress_index=avg_stress,
        first_choice_accuracy=avg_accuracy,
        focus_watch_count=0,
        participant_count=max(1, all_players),
        top_distractor_rate=0.0,
    )
    overview_trust_bundle = build_trust_bundle(
        evidence_count=len(session_summaries),
        observed_headline="Observed facts",
        observed_body=(
            f"{hosted_count} hosted sessions, {all_players} total players, {avg_accuracy:.1f}% average accuracy, and {avg_stress:.1f} average stress."
        ),
        interpretation_headline=overview_headline,
        interpretation_body=(
            "Use this overview to decide which class to reopen first, then drill into the full analytics board for evidence and next-step actions."
        ),
        teacher_action=overview_action,
        raw_facts=[
            build_metric("Hosted sessions", hosted_count),
            build_metric("Total players", all_players),
            build_metric("Average accuracy", avg_accuracy, "%"),
            build_metric("Average stress", avg_stress, "%"),
        ],
        grading_safe_metrics=[
            build_metric("Hosted sessions", hosted_count),
            build_metric("Total players", all_players),
            build_metric("Average accuracy", avg_accuracy, "%"),
        ],
        behavior_signal_metrics=[
            build_metric("Average stress", avg_stress, "%"),
        ],
    )

    return {
        "analytics_version": ANALYTICS_VERSION,
        "summary": {
            "total_players": all_players,
            "avg_accuracy": avg_accuracy,
            "quizzes_hosted": hosted_count,
            "avg_stress": avg_stress,
            **overview_trust_bundle,
        },
        "recent_sessions": session_summaries[:10],
        "insights": insights,
    }
