from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import settings
from app.core.security import decode_access_token
from app.models.user import User, UserStatus

router = APIRouter(prefix="/api/files", tags=["files"])


def get_file_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> User:
    raw_token = token
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()

    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    sub = decode_access_token(raw_token)
    if sub is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != UserStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not available")
    return user


@router.get("/{file_path:path}")
def get_protected_file(
    file_path: str,
    _user: User = Depends(get_file_user),
):
    uploads_root = Path(settings.UPLOAD_DIR).resolve()
    target = (uploads_root / file_path).resolve()

    if uploads_root not in target.parents and target != uploads_root:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(target)
