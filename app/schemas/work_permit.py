from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.work_permit import PermitStatus, PermitType
from app.schemas.area import AreaOut
from app.schemas.user import UserOut


class WorkPermitCreate(BaseModel):
    type: PermitType
    area_id: int
    responsible_person: str
    description: Optional[str] = None
    previous_permit_id: Optional[int] = None


class WorkPermitOut(BaseModel):
    id: int
    type: PermitType
    area_id: int
    applicant_id: int
    responsible_person: str
    description: Optional[str] = None
    photo_url: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: PermitStatus
    previous_permit_id: Optional[int] = None
    created_at: datetime
    area: Optional[AreaOut] = None
    applicant: Optional[UserOut] = None

    class Config:
        from_attributes = True


class WorkPermitWarning(BaseModel):
    """预警信息 DTO"""

    permit_id: int
    type: PermitType
    responsible_person: str
    area_name: str
    end_time: datetime
    hours_remaining: float
    status: PermitStatus
