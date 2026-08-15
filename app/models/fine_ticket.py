import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class FineTicketType(str, enum.Enum):
    QUALITY = "quality"
    SAFETY = "safety"


class FineTicket(Base):
    __tablename__ = "fine_tickets"

    id = Column(Integer, primary_key=True, index=True)
    number = Column(String(32), unique=True, nullable=False, index=True)
    ticket_type = Column(SAEnum(FineTicketType), nullable=False, index=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=True, index=True)
    project_name = Column(String(200), nullable=False)
    team_name = Column(String(200), nullable=False)
    location = Column(String(200), nullable=False)
    discovery_date = Column(String(32), nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    description = Column(Text, nullable=False)
    rule_id = Column(String(80), nullable=True, index=True)
    rule_reference = Column(Text, nullable=True)
    document_path = Column(String(500), nullable=False)
    photo_count = Column(Integer, default=0, nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    creator = relationship("User")
    area = relationship("Area")
