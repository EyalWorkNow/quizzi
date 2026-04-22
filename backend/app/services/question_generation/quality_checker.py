from app.services.question_generation.interfaces import CandidateQuestion, QualityResult
from app.services.question_generation.similarity_detector import JaccardSimilarityDetector
from app.utils.profanity import has_profanity


class DeterministicQualityChecker:
    def __init__(self) -> None:
        self.similarity = JaccardSimilarityDetector()

    def evaluate(self, candidate: CandidateQuestion, existing_questions: list[str]) -> QualityResult:
        reasons: list[str] = []

        correct_count = sum(1 for option in candidate.options if option.is_correct)
        if correct_count != 1:
            reasons.append("must_have_single_correct_answer")

        if len(candidate.options) < 4:
            reasons.append("must_have_four_options")

        distractors = [o for o in candidate.options if not o.is_correct]
        if any(len(d.text.split()) < 2 for d in distractors):
            reasons.append("distractors_not_plausible")

        combined_text = " ".join([candidate.stem, candidate.explanation] + [o.text for o in candidate.options])
        if has_profanity(combined_text):
            reasons.append("contains_profanity")

        for existing in existing_questions:
            if self.similarity.jaccard(candidate.stem, existing) >= 0.92:
                reasons.append("possible_duplicate")
                break

        return QualityResult(passed=not reasons, reasons=reasons)
