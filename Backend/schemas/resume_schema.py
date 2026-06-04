from pydantic import BaseModel
from typing import List


class ExperienceItem(BaseModel):
    company: str = ""
    role: str = ""
    duration: str = ""
    bullets: List[str] = []


class EducationItem(BaseModel):
    school: str = ""
    degree: str = ""
    year: str = ""


class ResumeSchema(BaseModel):
    summary: str = ""
    skills: List[str] = []
    experience: List[ExperienceItem] = []
    education: List[EducationItem] = []