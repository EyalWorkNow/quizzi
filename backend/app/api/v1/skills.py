from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Skill, Teacher
from app.db.session import get_db

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillCreate(BaseModel):
    class_id: str | None = None
    name: str
    description: str
    grade_level: str
    parent_skill_id: str | None = None


class SkillOut(SkillCreate):
    id: str


@router.post("", response_model=SkillOut)
def create_skill(
    payload: SkillCreate,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SkillOut:
    skill = Skill(
        class_id=payload.class_id,
        name=payload.name,
        description=payload.description,
        grade_level=payload.grade_level,
        parent_skill_id=payload.parent_skill_id,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return SkillOut(
        id=skill.id,
        class_id=skill.class_id,
        name=skill.name,
        description=skill.description,
        grade_level=skill.grade_level,
        parent_skill_id=skill.parent_skill_id,
    )


@router.get("", response_model=list[SkillOut])
def list_skills(
    class_id: str | None = None,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> list[SkillOut]:
    stmt = select(Skill)
    if class_id:
        stmt = stmt.where(Skill.class_id == class_id)
    skills = list(db.scalars(stmt).all())
    return [
        SkillOut(
            id=s.id,
            class_id=s.class_id,
            name=s.name,
            description=s.description,
            grade_level=s.grade_level,
            parent_skill_id=s.parent_skill_id,
        )
        for s in skills
    ]
