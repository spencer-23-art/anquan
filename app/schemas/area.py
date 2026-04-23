from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AreaCreate(BaseModel):
    name: str
    description: Optional[str] = None


class AreaUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AreaOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
