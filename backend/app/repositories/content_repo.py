from sqlalchemy import select

from app.db.models import ContentChunk, ContentSource, SourceStatus
from app.repositories.base import Repository


class ContentRepository(Repository):
    def create_source(
        self,
        class_id: str,
        source_type: str,
        title: str,
        raw_content: str,
        source_url: str | None,
    ) -> ContentSource:
        source = ContentSource(
            class_id=class_id,
            source_type=source_type,
            title=title,
            raw_content=raw_content,
            source_url=source_url,
            status=SourceStatus.pending,
        )
        return self.add_and_commit(source)

    def get_source(self, source_id: str) -> ContentSource | None:
        return self.db.scalar(select(ContentSource).where(ContentSource.id == source_id))

    def save_chunks(self, source_id: str, chunks: list[dict]) -> list[ContentChunk]:
        rows: list[ContentChunk] = []
        for chunk in chunks:
            row = ContentChunk(
                content_source_id=source_id,
                chunk_index=chunk["chunk_index"],
                content=chunk["content"],
                checksum=chunk["checksum"],
                metadata_json=chunk.get("metadata_json", {}),
            )
            self.db.add(row)
            rows.append(row)

        source = self.get_source(source_id)
        if source:
            source.status = SourceStatus.processed
        self.db.commit()
        for row in rows:
            self.db.refresh(row)
        return rows

    def list_chunks(self, source_id: str) -> list[ContentChunk]:
        return list(
            self.db.scalars(select(ContentChunk).where(ContentChunk.content_source_id == source_id)).all()
        )
