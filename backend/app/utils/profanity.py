PROFANITY_TERMS = {
    "damn",
    "hell",
}


def has_profanity(text: str) -> bool:
    normalized = text.lower()
    return any(word in normalized for word in PROFANITY_TERMS)
