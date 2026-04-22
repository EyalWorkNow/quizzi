from bs4 import BeautifulSoup
from readability import Document


def extract_readable_text(html: str) -> str:
    doc = Document(html)
    summary = doc.summary()
    soup = BeautifulSoup(summary, "html.parser")
    text = soup.get_text(" ", strip=True)
    return " ".join(text.split())
