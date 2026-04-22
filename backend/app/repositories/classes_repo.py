import secrets

from sqlalchemy import select

from app.db.models import Classroom, Student
from app.repositories.base import Repository


class ClassesRepository(Repository):
    def create_class(self, teacher_id: str, name: str, grade_level: str) -> Classroom:
        classroom = Classroom(
            teacher_id=teacher_id,
            name=name,
            grade_level=grade_level,
            join_code=self._generate_join_code(),
        )
        return self.add_and_commit(classroom)

    def list_classes(self, teacher_id: str) -> list[Classroom]:
        return list(self.db.scalars(select(Classroom).where(Classroom.teacher_id == teacher_id)).all())

    def get_class(self, class_id: str, teacher_id: str) -> Classroom | None:
        return self.db.scalar(
            select(Classroom).where(Classroom.id == class_id, Classroom.teacher_id == teacher_id)
        )

    def get_class_by_join_code(self, join_code: str) -> Classroom | None:
        return self.db.scalar(select(Classroom).where(Classroom.join_code == join_code))

    def add_student(self, class_id: str, pseudonym: str, display_name: str | None) -> Student:
        student = Student(class_id=class_id, pseudonym=pseudonym, display_name=display_name)
        return self.add_and_commit(student)

    def find_student_by_pseudonym(self, class_id: str, pseudonym: str) -> Student | None:
        return self.db.scalar(
            select(Student).where(Student.class_id == class_id, Student.pseudonym == pseudonym)
        )

    def list_students(self, class_id: str) -> list[Student]:
        return list(self.db.scalars(select(Student).where(Student.class_id == class_id)).all())

    def rotate_join_code(self, classroom: Classroom) -> Classroom:
        classroom.join_code = self._generate_join_code()
        self.db.commit()
        self.db.refresh(classroom)
        return classroom

    def _generate_join_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(20):
            code = "".join(secrets.choice(alphabet) for _ in range(8))
            exists = self.db.scalar(select(Classroom.id).where(Classroom.join_code == code))
            if not exists:
                return code
        raise RuntimeError("Failed to generate unique class join code")
