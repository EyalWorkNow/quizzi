import csv
import io

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.core.config import get_settings
from app.db.models import Classroom, Roster, Teacher
from app.db.session import get_db
from app.repositories.classes_repo import ClassesRepository
from app.schemas.classroom import (
    ClassCreate,
    ClassOut,
    ClassRegistrationOut,
    RosterImportRequest,
    StudentOut,
)

router = APIRouter(prefix="/classes", tags=["classes"])
settings = get_settings()


@router.post("", response_model=ClassOut)
def create_class(
    payload: ClassCreate,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> ClassOut:
    repo = ClassesRepository(db)
    classroom = repo.create_class(teacher.id, payload.name, payload.grade_level)
    return ClassOut(
        id=classroom.id,
        name=classroom.name,
        grade_level=classroom.grade_level,
        join_code=classroom.join_code,
        created_at=classroom.created_at,
    )


@router.get("", response_model=list[ClassOut])
def list_classes(db: Session = Depends(get_db), teacher: Teacher = Depends(get_current_teacher)) -> list[ClassOut]:
    repo = ClassesRepository(db)
    classes = repo.list_classes(teacher.id)
    return [
        ClassOut(
            id=c.id,
            name=c.name,
            grade_level=c.grade_level,
            join_code=c.join_code,
            created_at=c.created_at,
        )
        for c in classes
    ]


@router.post("/{class_id}/roster/import", response_model=list[StudentOut])
def import_roster(
    class_id: str,
    payload: RosterImportRequest,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> list[StudentOut]:
    repo = ClassesRepository(db)
    classroom = repo.get_class(class_id, teacher.id)
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    reader = csv.DictReader(io.StringIO(payload.csv_text))
    rows = list(reader)
    created = []
    for idx, row in enumerate(rows, start=1):
        pseudonym = row.get("pseudonym") or row.get("nickname") or f"Student-{idx}"
        display_name = row.get("display_name")
        created.append(repo.add_student(class_id, pseudonym, display_name))

    roster = Roster(class_id=class_id, source_type="csv", file_name="inline.csv", row_count=len(rows))
    db.add(roster)
    db.commit()

    return [
        StudentOut(
            id=s.id,
            class_id=s.class_id,
            pseudonym=s.pseudonym,
            display_name=s.display_name,
            created_at=s.created_at,
        )
        for s in created
    ]


@router.get("/{class_id}/students", response_model=list[StudentOut])
def list_students(
    class_id: str,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> list[StudentOut]:
    classroom = db.get(Classroom, class_id)
    if not classroom or classroom.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    repo = ClassesRepository(db)
    students = repo.list_students(class_id)
    return [
        StudentOut(
            id=s.id,
            class_id=s.class_id,
            pseudonym=s.pseudonym,
            display_name=s.display_name,
            created_at=s.created_at,
        )
        for s in students
    ]


@router.get("/{class_id}/registration", response_model=ClassRegistrationOut)
def class_registration(
    class_id: str,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> ClassRegistrationOut:
    classroom = db.get(Classroom, class_id)
    if not classroom or classroom.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    registration_url = f"{settings.frontend_origin}/student/register?class_code={classroom.join_code}"
    return ClassRegistrationOut(
        class_id=classroom.id,
        join_code=classroom.join_code,
        registration_url=registration_url,
    )


@router.post("/{class_id}/registration/rotate", response_model=ClassRegistrationOut)
def rotate_class_registration(
    class_id: str,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> ClassRegistrationOut:
    repo = ClassesRepository(db)
    classroom = repo.get_class(class_id, teacher.id)
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    classroom = repo.rotate_join_code(classroom)
    registration_url = f"{settings.frontend_origin}/student/register?class_code={classroom.join_code}"
    return ClassRegistrationOut(
        class_id=classroom.id,
        join_code=classroom.join_code,
        registration_url=registration_url,
    )
