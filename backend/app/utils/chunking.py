import hashlib
from dataclasses import dataclass


@dataclass
class Chunk:
    index: int
    content: str
    checksum: str


def chunk_text(text: str, chunk_size: int = 650, overlap: int = 100) -> list[Chunk]:
    normalized = " ".join(text.split())
    if not normalized:
        return []

    chunks: list[Chunk] = []
    start = 0
    idx = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        body = normalized[start:end]
        checksum = hashlib.sha256(body.encode("utf-8")).hexdigest()
        chunks.append(Chunk(index=idx, content=body, checksum=checksum))
        if end >= len(normalized):
            break
        start = max(0, end - overlap)
        idx += 1
    return chunks
