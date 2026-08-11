from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.task import CheckItemStatus, Severity, TaskStatus
from app.schemas.area import AreaOut
from app.schemas.user import UserOut
from app.schemas.work_permit import WorkPermitOut


class ChecklistItemCreate(BaseModel):
    risk_description: str
    inspection_points: Optional[str] = None
    photo_requirements: Optional[str] = None
    measure: Optional[str] = None
    severity: Severity = Severity.MEDIUM


class ChecklistItemOut(BaseModel):
    id: int
    task_id: int
    risk_description: str
    inspection_points: Optional[str] = None
    photo_requirements: Optional[str] = None
    measure: Optional[str] = None
    severity: Severity
    status: CheckItemStatus
    photo_url: Optional[str] = None
    note: Optional[str] = None
    checked_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ChecklistItemCheck(BaseModel):
    note: Optional[str] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    area_id: int
    project_name: Optional[str] = None
    work_point: Optional[str] = None
    process_name: Optional[str] = None
    assignee_id: int
    checklist_items: List[ChecklistItemCreate] = Field(min_length=1)


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    area_id: int
    project_name: Optional[str] = None
    work_point: Optional[str] = None
    process_name: Optional[str] = None
    assignee_id: int
    creator_id: int
    status: TaskStatus
    ai_session_id: Optional[str] = None
    required_permits: Optional[List[dict[str, Any]]] = []
    created_at: datetime
    completed_at: Optional[datetime] = None
    checklist_items: List[ChecklistItemOut] = []
    area: Optional[AreaOut] = None
    assignee: Optional[UserOut] = None
    associated_permits: List[WorkPermitOut] = []

    class Config:
        from_attributes = True

    @field_validator("required_permits", mode="before")
    @classmethod
    def parse_required_permits(cls, value):
        if not value:
            return []
        if isinstance(value, str):
            import json

            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return []
        return value


class TaskFromAI(BaseModel):
    title: str
    description: Optional[str] = None
    area_id: int
    project_name: Optional[str] = None
    work_point: Optional[str] = None
    process_name: Optional[str] = None
    assignee_id: int
    session_id: str
    checklist_items: List[ChecklistItemCreate] = Field(min_length=1)
