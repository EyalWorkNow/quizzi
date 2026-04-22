from app.utils.chunking import chunk_text


def test_chunk_text_produces_multiple_chunks() -> None:
    text = "A " * 1200
    chunks = chunk_text(text, chunk_size=200, overlap=50)
    assert len(chunks) > 3
    assert chunks[0].index == 0
    assert all(chunk.checksum for chunk in chunks)
