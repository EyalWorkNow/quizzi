from app.services.question_generation.interfaces import CandidateOption, CandidateQuestion
from app.services.question_generation.quality_checker import DeterministicQualityChecker


def test_quality_checker_rejects_multiple_correct_answers() -> None:
    checker = DeterministicQualityChecker()
    candidate = CandidateQuestion(
        stem="What is 1/2?",
        explanation="Half",
        difficulty="easy",
        source_chunk_id=None,
        options=[
            CandidateOption(option_key="A", text="Half", is_correct=True),
            CandidateOption(option_key="B", text="Also half", is_correct=True),
            CandidateOption(option_key="C", text="Quarter", is_correct=False),
            CandidateOption(option_key="D", text="Third", is_correct=False),
        ],
        skill_tags=["s1"],
        misconception_tags=[],
    )

    result = checker.evaluate(candidate, [])
    assert not result.passed
    assert "must_have_single_correct_answer" in result.reasons
