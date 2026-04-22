import json

from app.services.question_generation.gemini_generator import GeminiQuestionGenerator


def test_gemini_generator_parses_candidate_payload(monkeypatch) -> None:
    class DummyResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            payload = {
                "questions": [
                    {
                        "stem": "What best explains equivalent fractions?",
                        "explanation": "Equivalent fractions represent the same quantity.",
                        "difficulty": "easy",
                        "source_chunk_id": "c1",
                        "skill_tags": ["s1"],
                        "misconception_tags": ["confuses_equivalence"],
                        "options": [
                            {"option_key": "A", "text": "They have same value", "is_correct": True, "misconception_tag": None},
                            {
                                "option_key": "B",
                                "text": "They always have same denominator",
                                "is_correct": False,
                                "misconception_tag": "confuses_denominator",
                            },
                            {
                                "option_key": "C",
                                "text": "They are different topics",
                                "is_correct": False,
                                "misconception_tag": "confuses_scope",
                            },
                            {
                                "option_key": "D",
                                "text": "They only apply in geometry",
                                "is_correct": False,
                                "misconception_tag": "confuses_domain",
                            },
                        ],
                    }
                ]
            }
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": json.dumps(payload)}
                            ]
                        }
                    }
                ]
            }

    def fake_post(*args, **kwargs):  # noqa: ANN002, ANN003
        return DummyResponse()

    monkeypatch.setattr("app.services.question_generation.gemini_generator.httpx.post", fake_post)

    generator = GeminiQuestionGenerator(api_key="key", model="gemini-test", timeout_sec=5)
    rows = generator.generate(
        chunks=[{"id": "c1", "content": "Equivalent fractions represent the same value."}],
        skill_context=[{"id": "s1", "name": "Fractions"}],
        count=1,
        difficulty_mix={"easy": 1},
    )

    assert len(rows) == 1
    assert rows[0].skill_tags == ["s1"]
    assert len(rows[0].options) == 4
    assert sum(1 for option in rows[0].options if option.is_correct) == 1
