from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.database import Base


class SystemConfig(Base):
    """Simple key/value storage for runtime system settings."""

    __tablename__ = "system_configs"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    AI_BASE_URL = "ai_base_url"
    AI_API_KEY = "ai_api_key"
    AI_MODEL = "ai_model"
    AI_PROVIDER_CONFIGS = "ai_provider_configs"
    AI_ACTIVE_PROVIDER = "ai_active_provider"
