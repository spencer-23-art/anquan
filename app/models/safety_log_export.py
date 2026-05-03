from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class SafetyLogExport(Base):
    __tablename__ = "safety_log_exports"

    id = Column(Integer, primary_key=True, index=True)
    subject_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    exported_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    log_date = Column(Date, nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    subject_user = relationship("User", foreign_keys=[subject_user_id])
    exported_by = relationship("User", foreign_keys=[exported_by_id])
