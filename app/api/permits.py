import os
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db, require_admin
from app.config import settings
from app.models.area import Area
from app.models.user import User
from app.models.work_permit import (
    PERMIT_DURATION_HOURS,
    WARNING_THRESHOLD_PERCENT,
    PermitStatus,
    PermitType,
    WorkPermit,
)
from app.schemas.work_permit import WorkPermitOut, WorkPermitWarning

router = APIRouter(prefix="/api/permits", tags=["permits"])


def local_now() -> datetime:
    return datetime.now()


def get_workday_start(now: Optional[datetime] = None) -> datetime:
    current = now or local_now()
    return current.replace(hour=7, minute=0, second=0, microsecond=0)


async def read_limited_upload(upload: UploadFile) -> bytes:
    content = await upload.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Upload too large. Max {settings.MAX_UPLOAD_SIZE // 1024}KB",
        )
    return content


def refresh_permit_status(permit: WorkPermit, now: Optional[datetime] = None) -> bool:
    if not permit.start_time or not permit.end_time:
        return False

    now = now or local_now()
    total_seconds = (permit.end_time - permit.start_time).total_seconds()
    remaining_seconds = (permit.end_time - now).total_seconds()

    if remaining_seconds <= 0:
        new_status = PermitStatus.EXPIRED
    else:
        remaining_percent = (
            remaining_seconds / total_seconds * 100 if total_seconds > 0 else 0
        )
        new_status = (
            PermitStatus.WARNING
            if remaining_percent <= WARNING_THRESHOLD_PERCENT
            else PermitStatus.ACTIVE
        )

    if permit.status != new_status:
        permit.status = new_status
        return True

    return False


@router.post("", response_model=WorkPermitOut, status_code=201)
async def create_permit(
    type: PermitType = Form(...),
    area_id: int = Form(...),
    responsible_person: str = Form(...),
    description: str = Form(default=""),
    previous_permit_id: Optional[int] = Form(default=None),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo must be an image")

    upload_dir = os.path.join(settings.UPLOAD_DIR, "permits")
    os.makedirs(upload_dir, exist_ok=True)
    ext = photo.filename.split(".")[-1] if photo.filename else "jpg"
    filename = f"permit_{datetime.now().strftime('%Y%m%d%H%M%S')}_{current_user.id}.{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await read_limited_upload(photo)
    with open(filepath, "wb") as file_obj:
        file_obj.write(content)

    start_time = get_workday_start()
    duration_hours = PERMIT_DURATION_HOURS.get(type, 7 * 24)
    end_time = start_time + timedelta(hours=duration_hours)

    if previous_permit_id is not None:
        prev = db.query(WorkPermit).filter(WorkPermit.id == previous_permit_id).first()
        if not prev:
            raise HTTPException(status_code=400, detail="Previous permit not found")
        if prev.status != PermitStatus.EXPIRED:
            raise HTTPException(
                status_code=400,
                detail="Only expired permits can be used to create a new application",
            )

    permit = WorkPermit(
        type=type,
        area_id=area_id,
        applicant_id=current_user.id,
        responsible_person=responsible_person,
        description=description,
        photo_url=f"/uploads/permits/{filename}",
        start_time=start_time,
        end_time=end_time,
        status=PermitStatus.ACTIVE,
        previous_permit_id=previous_permit_id,
    )
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return permit


@router.get("", response_model=List[WorkPermitOut])
def list_permits(
    status_filter: Optional[str] = None,
    area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    now = local_now()
    query = db.query(WorkPermit).options(
        joinedload(WorkPermit.area),
        joinedload(WorkPermit.applicant),
    )
    if status_filter:
        query = query.filter(WorkPermit.status == status_filter)
    if area_id:
        query = query.filter(WorkPermit.area_id == area_id)
    permits = query.order_by(WorkPermit.created_at.desc()).all()

    changed = False
    for permit in permits:
        changed = refresh_permit_status(permit, now) or changed

    if changed:
        db.commit()

    return permits


@router.get("/warnings", response_model=List[WorkPermitWarning])
def get_warnings(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    now = local_now()
    permits = db.query(WorkPermit).filter(
        WorkPermit.status.in_([PermitStatus.WARNING, PermitStatus.ACTIVE])
    ).all()

    warnings: List[WorkPermitWarning] = []
    for permit in permits:
        refresh_permit_status(permit, now)
        if not permit.start_time or not permit.end_time:
            continue

        total_duration = (permit.end_time - permit.start_time).total_seconds()
        remaining = (permit.end_time - now).total_seconds()

        if remaining <= 0:
            status = PermitStatus.EXPIRED
            hours_remaining = 0.0
        else:
            remaining_percent = (remaining / total_duration * 100) if total_duration > 0 else 0
            if remaining_percent >= WARNING_THRESHOLD_PERCENT:
                continue
            status = PermitStatus.WARNING
            hours_remaining = remaining / 3600

        area = db.query(Area).filter(Area.id == permit.area_id).first()
        warnings.append(
            WorkPermitWarning(
                permit_id=permit.id,
                type=permit.type,
                responsible_person=permit.responsible_person,
                area_name=area.name if area else "Unknown",
                end_time=permit.end_time,
                hours_remaining=max(0, round(hours_remaining, 1)),
                status=status,
            )
        )

    warnings.sort(key=lambda item: item.hours_remaining)
    db.commit()
    return warnings


@router.get("/{permit_id}", response_model=WorkPermitOut)
def get_permit(
    permit_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    permit = (
        db.query(WorkPermit)
        .options(joinedload(WorkPermit.area), joinedload(WorkPermit.applicant))
        .filter(WorkPermit.id == permit_id)
        .first()
    )
    if not permit:
        raise HTTPException(status_code=404, detail="Permit not found")
    if refresh_permit_status(permit):
        db.commit()
        db.refresh(permit)
    return permit


@router.post("/manual", response_model=WorkPermitOut, status_code=201)
async def create_manual_permit(
    type: PermitType = Form(...),
    area_id: int = Form(...),
    responsible_person: str = Form(...),
    description: str = Form(default=""),
    duration_days: Optional[int] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start_time = get_workday_start()
    if duration_days:
        end_time = start_time + timedelta(days=duration_days)
    else:
        duration_hours = PERMIT_DURATION_HOURS.get(type, 168)
        end_time = start_time + timedelta(hours=duration_hours)

    permit = WorkPermit(
        type=type,
        area_id=area_id,
        applicant_id=current_user.id,
        responsible_person=responsible_person,
        description=description,
        photo_url=None,
        start_time=start_time,
        end_time=end_time,
        status=PermitStatus.ACTIVE,
    )
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return permit


@router.post("/{permit_id}/renew")
async def renew_permit(
    permit_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    permit = db.query(WorkPermit).filter(WorkPermit.id == permit_id).first()
    if not permit:
        raise HTTPException(status_code=404, detail="Permit not found")
    raise HTTPException(
        status_code=400,
        detail="Permit renewal is disabled. Create a new application instead.",
    )


@router.delete("/{permit_id}")
def delete_permit(
    permit_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_admin),
):
    permit = db.query(WorkPermit).filter(WorkPermit.id == permit_id).first()
    if not permit:
        raise HTTPException(status_code=404, detail="Permit not found")
    db.delete(permit)
    db.commit()
    return {"message": "Permit deleted"}
