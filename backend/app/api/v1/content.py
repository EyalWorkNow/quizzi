from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Teacher
from app.db.session import get_db
from app.schemas.content import CandidateGenerationResult, ContentSourceCreate, ContentSourceOut, GenerateCandidatesRequest
from app.services.ingest_service import IngestService

router = APIRouter(prefix="/content", tags=["content"])


@router.post("/sources", response_model=ContentSourceOut)
def create_source(
    payload: ContentSourceCreate,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> ContentSourceOut:
    service = IngestService(db)
    source = service.create_source(
        class_id=payload.class_id,
        source_type=payload.source_type,
        title=payload.title,
        raw_content=payload.raw_content,
        source_url=str(payload.source_url) if payload.source_url else None,
    )
    return ContentSourceOut(
        id=source.id,
        class_id=source.class_id,
        title=source.title,
        source_type=source.source_type.value,
        status=source.status.value,
        created_at=source.created_at,
    )


@router.post("/sources/{source_id}/generate-candidates", response_model=CandidateGenerationResult)
def generate_candidates(
    source_id: str,
    payload: GenerateCandidatesRequest,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> CandidateGenerationResult:
    service = IngestService(db)
    result = service.generate_candidates(source_id, payload.count, payload.skill_ids, payload.provider)
    return CandidateGenerationResult(**result)
