from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import settings
from app.core.security import decode_access_token
from app.models.fine_ticket import FineTicket
from app.models.task import ChecklistItem, Task
from app.models.user import User, UserRole, UserStatus
from app.models.work_permit import WorkPermit, WorkPermitRenewal
from app.services.area_scope import is_area_scoped_user, is_super_admin, managed_area_ids

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


def can_access_upload(db: Session, user: User, upload_url: str) -> bool:
    if is_super_admin(user):
        return True

    allowed_area_ids = managed_area_ids(db, user)
    permit_query = db.query(WorkPermit).filter(
        (WorkPermit.photo_url == upload_url) |
        WorkPermit.id.in_(
            db.query(WorkPermitRenewal.permit_id).filter(
                (WorkPermitRenewal.old_photo_url == upload_url) |
                (WorkPermitRenewal.new_photo_url == upload_url)
            )
        )
    )
    task_query = (
        db.query(Task)
        .join(ChecklistItem, ChecklistItem.task_id == Task.id)
        .filter(
            or_(
                ChecklistItem.photo_url == upload_url,
                ChecklistItem.photo_url.like(f"{upload_url},%"),
                ChecklistItem.photo_url.like(f"%,{upload_url}"),
                ChecklistItem.photo_url.like(f"%,{upload_url},%"),
            )
        )
    )

    if is_area_scoped_user(user):
        if not allowed_area_ids:
            return False
        if permit_query.filter(WorkPermit.area_id.in_(allowed_area_ids)).first():
            return True
        if task_query.filter(Task.area_id.in_(allowed_area_ids)).first():
            return True
        if (
            db.query(FineTicket)
            .filter(FineTicket.area_id.in_(allowed_area_ids))
            .filter(FineTicket.document_path.like(f"%{upload_url.removeprefix('/uploads/')}%"))
            .first()
        ):
            return True
        return False

    if user.role == UserRole.INSPECTOR:
        if permit_query.filter(
            or_(
                WorkPermit.applicant_id == user.id,
                WorkPermit.task.has(Task.assignee_id == user.id),
            )
        ).first():
            return True
        if task_query.filter(Task.assignee_id == user.id).first():
            return True
        return False

    if permit_query.filter(WorkPermit.applicant_id == user.id).first():
        return True
    if task_query.filter(Task.assignee_id == user.id).first():
        return True
    return False


@router.get("/{file_path:path}")
def get_protected_file(
    file_path: str,
    user: User = Depends(get_file_user),
    db: Session = Depends(get_db),
):
    uploads_root = Path(settings.UPLOAD_DIR).resolve()
    target = (uploads_root / file_path).resolve()

    if uploads_root not in target.parents and target != uploads_root:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    normalized_file_path = file_path.replace("\\", "/")
    upload_url = f"/uploads/{normalized_file_path}"
    if not can_access_upload(db, user, upload_url):
        raise HTTPException(status_code=403, detail="No permission to access this file")

    return FileResponse(
        target,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )
