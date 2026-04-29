from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

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
    assignee_id: int
    checklist_items: List[ChecklistItemCreate] = []


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    area_id: int
    assignee_id: int
    creator_id: int
    status: TaskStatus
    ai_session_id: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    checklist_items: List[ChecklistItemOut] = []
    area: Optional[AreaOut] = None
    assignee: Optional[UserOut] = None
    associated_permits: List[WorkPermitOut] = []

    class Config:
        from_attributes = True


class TaskFromAI(BaseModel):
    title: str
    description: Optional[str] = None
    area_id: int
    assignee_id: int
    session_id: str
    checklist_items: List[ChecklistItemCreate]
