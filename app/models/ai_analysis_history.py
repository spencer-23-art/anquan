from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class AIAnalysisHistory(Base):
    __tablename__ = "ai_analysis_histories"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=True, index=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ai_session_id = Column(String(64), nullable=False, index=True)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    area = relationship("Area")
    creator = relationship("User")
