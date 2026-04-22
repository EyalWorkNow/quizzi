from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    auth,
    classes,
    content,
    dashboard,
    diagnostics,
    passports,
    questions,
    quizzes,
    sessions,
    skills,
    students,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(analytics.router)
api_router.include_router(classes.router)
api_router.include_router(students.router)
api_router.include_router(skills.router)
api_router.include_router(content.router)
api_router.include_router(questions.router)
api_router.include_router(quizzes.router)
api_router.include_router(sessions.router)
api_router.include_router(dashboard.router)
api_router.include_router(diagnostics.router)
api_router.include_router(passports.router)
