from app.services.question_generation.similarity_detector import JaccardSimilarityDetector


def test_jaccard_similarity() -> None:
    detector = JaccardSimilarityDetector()
    score = detector.jaccard("fractions are equal parts", "equal parts in fractions")
    assert score > 0.4
    assert detector.jaccard("abc", "xyz") == 0.0
