import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.user import UserRole, UserStatus

PASSWORD_PATTERN = re.compile(r"^[\x20-\x7E]+$")


class UserRegister(BaseModel):
    username: str
    password: str
    real_name: str
    phone: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_must_be_ascii(cls, value: str) -> str:
        if not PASSWORD_PATTERN.match(value):
            raise ValueError("Password must contain only ASCII characters")
        if len(value) < 6:
            raise ValueError("Password must be at least 6 characters long")
        return value


class UserLogin(BaseModel):
    username: str
    password: str

    @field_validator("password")
    @classmethod
    def password_must_be_ascii(cls, value: str) -> str:
        if not PASSWORD_PATTERN.match(value):
            raise ValueError("Password must contain only ASCII characters")
        return value


class UserOut(BaseModel):
    id: int
    username: str
    real_name: str
    phone: Optional[str] = None
    role: UserRole
    managed_area_id: Optional[int] = None
    status: UserStatus
    created_at: datetime

    class Config:
        from_attributes = True


class UserApproval(BaseModel):
    status: UserStatus


class UserPermissionUpdate(BaseModel):
    role: UserRole
    managed_area_id: Optional[int] = None
    status: Optional[UserStatus] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
