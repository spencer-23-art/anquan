from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, comment="区域名称，如：厂房、造粒塔")
    description = Column(Text, nullable=True, comment="区域描述")
    created_at = Column(DateTime, default=datetime.utcnow)

    # relationships
    tasks = relationship("Task", back_populates="area")
    work_permits = relationship("WorkPermit", back_populates="area")
