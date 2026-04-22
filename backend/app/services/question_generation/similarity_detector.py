import re


class JaccardSimilarityDetector:
    def _tokens(self, text: str) -> set[str]:
        normalized = re.sub(r"[^a-z0-9\\s]", " ", text.lower())
        return {t for t in normalized.split() if t}

    def jaccard(self, text_a: str, text_b: str) -> float:
        a = self._tokens(text_a)
        b = self._tokens(text_b)
        if not a and not b:
            return 1.0
        if not a or not b:
            return 0.0
        intersection = len(a.intersection(b))
        union = len(a.union(b))
        return intersection / union
