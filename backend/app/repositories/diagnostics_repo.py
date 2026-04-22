from sqlalchemy import select

from app.db.models import Diagnostic, Passport
from app.repositories.base import Repository


class DiagnosticsRepository(Repository):
    def add_diagnostic(self, diagnostic: Diagnostic) -> Diagnostic:
        return self.add_and_commit(diagnostic)

    def list_session_diagnostics(self, session_id: str) -> list[Diagnostic]:
        return list(self.db.scalars(select(Diagnostic).where(Diagnostic.session_id == session_id)).all())

    def add_passport(self, passport: Passport) -> Passport:
        return self.add_and_commit(passport)

    def list_student_passports(self, class_id: str, student_id: str) -> list[Passport]:
        stmt = (
            select(Passport)
            .where(Passport.class_id == class_id, Passport.student_id == student_id)
            .order_by(Passport.created_at.asc())
        )
        return list(self.db.scalars(stmt).all())
