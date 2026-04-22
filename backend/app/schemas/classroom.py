from datetime import datetime

from pydantic import BaseModel, Field


class ClassCreate(BaseModel):
    name: str
    grade_level: str


class ClassOut(BaseModel):
    id: str
    name: str
    grade_level: str
    join_code: str
    created_at: datetime


class StudentCreate(BaseModel):
    pseudonym: str = Field(min_length=2, max_length=80)
    display_name: str | None = None


class StudentOut(BaseModel):
    id: str
    class_id: str
    pseudonym: str
    display_name: str | None = None
    created_at: datetime


class RosterImportRequest(BaseModel):
    csv_text: str


class ClassRegistrationOut(BaseModel):
    class_id: str
    join_code: str
    registration_url: str


class StudentSelfRegisterRequest(BaseModel):
    join_code: str = Field(min_length=4, max_length=16)
    pseudonym: str = Field(min_length=2, max_length=80)
    display_name: str | None = Field(default=None, max_length=120)


class StudentSelfRegisterOut(BaseModel):
    student_id: str
    class_id: str
    pseudonym: str
    display_name: str | None = None
