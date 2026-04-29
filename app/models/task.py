import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class CheckItemStatus(str, enum.Enum):
    PENDING = "pending"
    CHECKED = "checked"


class Severity(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(SAEnum(TaskStatus), default=TaskStatus.PENDING, nullable=False)
    ai_session_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    area = relationship("Area", back_populates="tasks")
    assignee = relationship("User", back_populates="assigned_tasks", foreign_keys=[assignee_id])
    creator = relationship("User", back_populates="created_tasks", foreign_keys=[creator_id])
    checklist_items = relationship("ChecklistItem", back_populates="task", cascade="all, delete-orphan")
    associated_permits = relationship("WorkPermit", back_populates="task", cascade="all, delete-orphan")


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    risk_description = Column(Text, nullable=False)
    inspection_points = Column(Text, nullable=True)
    photo_requirements = Column(Text, nullable=True)
    measure = Column(Text, nullable=True)
    severity = Column(SAEnum(Severity), default=Severity.MEDIUM, nullable=False)
    status = Column(SAEnum(CheckItemStatus), default=CheckItemStatus.PENDING, nullable=False)
    photo_url = Column(String(500), nullable=True)
    note = Column(Text, nullable=True)
    checked_at = Column(DateTime, nullable=True)

    task = relationship("Task", back_populates="checklist_items")
