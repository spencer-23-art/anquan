from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AIProviderConfigInput(BaseModel):
    id: Optional[str] = None
    name: str = ""
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    enabled: bool = True


class AIProviderConfigOut(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    enabled: bool = True
    is_active: bool = False
    api_key_masked: Optional[str] = None


class SystemConfigUpdate(BaseModel):
    ai_base_url: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_model: Optional[str] = None
    active_provider_id: Optional[str] = None
    providers: Optional[list[AIProviderConfigInput]] = None


class SystemConfigOut(BaseModel):
    ai_base_url: Optional[str] = None
    ai_api_key_masked: Optional[str] = None
    ai_model: Optional[str] = None
    active_provider_id: Optional[str] = None
    providers: list[AIProviderConfigOut] = []


class AIRuntimeConfigOut(BaseModel):
    ai_base_url: Optional[str] = None
    ai_model: Optional[str] = None
    active_provider_id: Optional[str] = None
    providers: list[AIProviderConfigOut] = []


class AIChatMessage(BaseModel):
    session_id: Optional[str] = None
    message: str
    provider_id: Optional[str] = None
    area_id: Optional[int] = None


class AIChatResponse(BaseModel):
    session_id: str
    type: str
    content: str


class AICreatePermitData(BaseModel):
    type: str
    end_time: Optional[str] = None
    photo_url: Optional[str] = None


class AICreateTaskRequest(BaseModel):
    session_id: str
    area_id: int
    assignee_id: int
    title: Optional[str] = None
    items: Optional[list[dict]] = []
    permits: Optional[list[AICreatePermitData]] = []


class AIAnalysisHistoryOut(BaseModel):
    id: int
    session_id: str
    title: str
    area_id: Optional[int] = None
    area_name: Optional[str] = None
    creator_name: Optional[str] = None
    item_count: int = 0
    permit_count: int = 0
    created_at: datetime
    payload: dict
