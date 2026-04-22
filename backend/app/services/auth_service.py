from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import Teacher
from app.schemas.auth import TeacherLogin, TeacherSignup


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def signup(self, payload: TeacherSignup) -> Teacher:
        existing = self.db.scalar(select(Teacher).where(Teacher.email == payload.email))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

        teacher = Teacher(email=payload.email, password_hash=hash_password(payload.password))
        self.db.add(teacher)
        self.db.commit()
        self.db.refresh(teacher)
        return teacher

    def login(self, payload: TeacherLogin) -> tuple[str, Teacher]:
        teacher = self.db.scalar(select(Teacher).where(Teacher.email == payload.email))
        if not teacher or not verify_password(payload.password, teacher.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        token = create_access_token(teacher.id)
        return token, teacher
