import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class PermitType(str, enum.Enum):
    HOT_WORK_LEVEL1 = "hot_work_level1"
    HOT_WORK_LEVEL2 = "hot_work_level2"
    HOT_WORK_LEVEL3 = "hot_work_level3"
    HEIGHT_LEVEL1 = "height_level1"
    HEIGHT_LEVEL2 = "height_level2"
    HEIGHT_LEVEL3 = "height_level3"
    HEIGHT_SPECIAL = "height_special"
    CONFINED_SPACE = "confined_space"
    LIFTING = "lifting"
    EXCAVATION = "excavation"
    ELECTRICAL = "electrical"
    OTHER = "other"


class PermitStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    WARNING = "warning"
    EXPIRED = "expired"


PERMIT_DURATION_HOURS = {
    PermitType.HOT_WORK_LEVEL1: 8,
    PermitType.HOT_WORK_LEVEL2: 72,
    PermitType.HOT_WORK_LEVEL3: 168,
    PermitType.HEIGHT_LEVEL1: 168,
    PermitType.HEIGHT_LEVEL2: 168,
    PermitType.HEIGHT_LEVEL3: 168,
    PermitType.HEIGHT_SPECIAL: 8,
    PermitType.CONFINED_SPACE: 12,
    PermitType.LIFTING: 168,
    PermitType.EXCAVATION: 168,
    PermitType.ELECTRICAL: 168,
    PermitType.OTHER: 168,
}

WARNING_THRESHOLD_PERCENT = 20


class WorkPermit(Base):
    __tablename__ = "work_permits"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(SAEnum(PermitType), nullable=False)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    applicant_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    responsible_person = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    photo_url = Column(String(500), nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    status = Column(SAEnum(PermitStatus), default=PermitStatus.PENDING, nullable=False)
    previous_permit_id = Column(Integer, ForeignKey("work_permits.id"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    area = relationship("Area", back_populates="work_permits")
    applicant = relationship("User", back_populates="work_permits", foreign_keys=[applicant_id])
    previous_permit = relationship("WorkPermit", remote_side="WorkPermit.id", uselist=False)
    task = relationship("Task", back_populates="associated_permits")
    renewals = relationship(
        "WorkPermitRenewal",
        back_populates="permit",
        cascade="all, delete-orphan",
    )


class WorkPermitRenewal(Base):
    __tablename__ = "work_permit_renewals"

    id = Column(Integer, primary_key=True, index=True)
    permit_id = Column(Integer, ForeignKey("work_permits.id", ondelete="CASCADE"), nullable=False, index=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    old_start_time = Column(DateTime, nullable=True)
    old_end_time = Column(DateTime, nullable=True)
    new_start_time = Column(DateTime, nullable=False)
    new_end_time = Column(DateTime, nullable=False)
    old_photo_url = Column(String(500), nullable=True)
    new_photo_url = Column(String(500), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    permit = relationship("WorkPermit", back_populates="renewals")
    operator = relationship("User")
