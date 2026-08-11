from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey("areas.id"), nullable=True, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    parent = relationship("Area", remote_side=[id], back_populates="children")
    children = relationship("Area", back_populates="parent", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="area")
    work_permits = relationship("WorkPermit", back_populates="area")
    managed_users = relationship("User", back_populates="managed_area")
