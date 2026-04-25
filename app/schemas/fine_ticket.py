from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class FineNumberPreview(BaseModel):
    number: str


class FineDescriptionRequest(BaseModel):
    input: str
    project_name: str = ""
    team_name: str = ""
    location: str = ""
    discovery_date: str = ""
    penalty_type: str = "quality"


class FineDescriptionResponse(BaseModel):
    description: str


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
    photo_count: int
    created_at: datetime
    creator_name: Optional[str] = None
    download_url: str

    class Config:
        from_attributes = True
