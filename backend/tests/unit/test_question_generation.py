from app.services.question_generation.deterministic_generator import DeterministicQuestionGenerator


def test_deterministic_generator_outputs_questions() -> None:
    generator = DeterministicQuestionGenerator()
    chunks = [{"id": "c1", "content": "Fractions represent parts of a whole. Equivalent fractions have the same value."}]
    skills = [{"id": "s1", "name": "Fractions"}]

    results = generator.generate(chunks=chunks, skill_context=skills, count=2, difficulty_mix={"easy": 1, "medium": 1})

    assert len(results) >= 1
    assert results[0].skill_tags == ["s1"]
    assert len(results[0].options) == 4
    assert sum(1 for option in results[0].options if option.is_correct) == 1
