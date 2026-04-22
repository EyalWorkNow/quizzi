from sqlalchemy.orm import Session

from app.repositories.diagnostics_repo import DiagnosticsRepository


class PassportService:
    def __init__(self, db: Session) -> None:
        self.repo = DiagnosticsRepository(db)

    def get_student_passport(self, class_id: str, student_id: str):
        return self.repo.list_student_passports(class_id, student_id)
