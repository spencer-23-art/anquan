from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class FineNumberPreview(BaseModel):
    number: str


class FineDescriptionRequest(BaseModel):
    input: str
    rule_id: Optional[str] = None
    project_name: str = ""
    team_name: str = ""
    location: str = ""
    discovery_date: str = ""
    penalty_type: str = "quality"


class FineDescriptionResponse(BaseModel):
    description: str
    rule_id: str
    rule_reference: str
    legal_basis: str
    technical_basis: str


class FineRuleOption(BaseModel):
    id: str
    label: str
    legal_basis: str
    technical_basis: str
    rule_reference: str
    source_url: Optional[str] = None
    matched_keywords: list[str] = Field(default_factory=list)
    is_recommended: bool = False


class FineRuleOptionsResponse(BaseModel):
    options: list[FineRuleOption]
    recommended_rule_id: Optional[str] = None


class FineTicketCreateResponse(BaseModel):
    id: int
    number: str
    filename: str
    download_url: str
    area_id: Optional[int] = None


class FineTicketHistoryItem(BaseModel):
    id: int
    number: str
    ticket_type: str
    area_id: Optional[int] = None
    area_name: Optional[str] = None
    project_name: str
    team_name: str
    location: str
    discovery_date: Optional[str] = None
    amount: Decimal
    description: str
    rule_id: Optional[str] = None
    rule_reference: Optional[str] = None
    photo_count: int
    created_at: datetime
    creator_name: Optional[str] = None
    download_url: str

    class Config:
        from_attributes = True
