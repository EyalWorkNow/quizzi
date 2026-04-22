from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Teacher
from app.db.session import get_db
from app.schemas.auth import AuthToken, TeacherLogin, TeacherOut, TeacherSignup
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthToken)
def signup(payload: TeacherSignup, response: Response, db: Session = Depends(get_db)) -> AuthToken:
    service = AuthService(db)
    teacher = service.signup(payload)
    token, _ = service.login(TeacherLogin(email=payload.email, password=payload.password))

    response.set_cookie("quizzy_access", token, httponly=True, samesite="lax")
    return AuthToken(
        access_token=token,
        teacher=TeacherOut(id=teacher.id, email=teacher.email, created_at=teacher.created_at),
    )


@router.post("/login", response_model=AuthToken)
def login(payload: TeacherLogin, response: Response, db: Session = Depends(get_db)) -> AuthToken:
    service = AuthService(db)
    token, teacher = service.login(payload)
    response.set_cookie("quizzy_access", token, httponly=True, samesite="lax")
    return AuthToken(
        access_token=token,
        teacher=TeacherOut(id=teacher.id, email=teacher.email, created_at=teacher.created_at),
    )


@router.get("/me", response_model=TeacherOut)
def me(teacher: Teacher = Depends(get_current_teacher)) -> TeacherOut:
    return TeacherOut(id=teacher.id, email=teacher.email, created_at=teacher.created_at)


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("quizzy_access")
    return {"ok": True}
