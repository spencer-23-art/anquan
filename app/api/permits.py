import os
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db, require_admin
from app.config import settings
from app.models.area import Area
from app.models.task import Task
from app.models.user import User, UserRole
from app.models.work_permit import (
    PERMIT_DURATION_HOURS,
    WARNING_THRESHOLD_PERCENT,
    PermitStatus,
    PermitType,
    WorkPermit,
    WorkPermitRenewal,
)
from app.schemas.work_permit import WorkPermitOut, WorkPermitRenewalOut, WorkPermitWarning
from app.services.area_scope import ensure_area_access, managed_area_ids

router = APIRouter(prefix="/api/permits", tags=["permits"])


def local_now() -> datetime:
    return datetime.now()


def get_permit_start_time(permit_type: PermitType, now: Optional[datetime] = None) -> datetime:
    current = now or local_now()
    workday_start = current.replace(hour=7, minute=0, second=0, microsecond=0)
    planned_end = calculate_end_time(permit_type, workday_start)
    if current >= planned_end:
        return current.replace(microsecond=0)
    return workday_start


async def read_limited_upload(upload: UploadFile) -> bytes:
    content = await upload.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Upload too large. Max {settings.MAX_UPLOAD_SIZE // 1024}KB",
        )
    return content


async def save_permit_photo(photo: UploadFile, current_user: User) -> str:
    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo must be an image")

    upload_dir = os.path.join(settings.UPLOAD_DIR, "permits")
    os.makedirs(upload_dir, exist_ok=True)
    ext = photo.filename.rsplit(".", 1)[-1] if photo.filename and "." in photo.filename else "jpg"
    filename = f"permit_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{current_user.id}.{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await read_limited_upload(photo)
    with open(filepath, "wb") as file_obj:
        file_obj.write(content)
    return f"/uploads/permits/{filename}"


def calculate_end_time(permit_type: PermitType, start_time: datetime) -> datetime:
    return start_time + timedelta(hours=PERMIT_DURATION_HOURS.get(permit_type, 168))


def refresh_permit_status(permit: WorkPermit, now: Optional[datetime] = None) -> bool:
    if not permit.start_time or not permit.end_time:
        return False

    now = now or local_now()
    total_seconds = (permit.end_time - permit.start_time).total_seconds()
    remaining_seconds = (permit.end_time - now).total_seconds()

    if remaining_seconds <= 0:
        new_status = PermitStatus.EXPIRED
    else:
        remaining_percent = remaining_seconds / total_seconds * 100 if total_seconds > 0 else 0
        new_status = PermitStatus.WARNING if remaining_percent <= WARNING_THRESHOLD_PERCENT else PermitStatus.ACTIVE

    if permit.status != new_status:
        permit.status = new_status
        return True
    return False


def scoped_permit_query(db: Session, current_user: User):
    query = db.query(WorkPermit).options(
        joinedload(WorkPermit.area),
        joinedload(WorkPermit.applicant),
    )
    query = query.filter(~((WorkPermit.task_id.isnot(None)) & (WorkPermit.photo_url.is_(None))))
    allowed_ids = managed_area_ids(db, current_user)
    if allowed_ids is not None and current_user.role == UserRole.ADMIN:
        query = query.filter(WorkPermit.area_id.in_(allowed_ids))
    return query


def get_scoped_permit(db: Session, permit_id: int, current_user: User) -> WorkPermit:
    permit = scoped_permit_query(db, current_user).filter(WorkPermit.id == permit_id).first()
    if not permit:
        raise HTTPException(status_code=404, detail="Permit not found")
    return permit


def ensure_permit_write_access(db: Session, permit: WorkPermit, current_user: User) -> None:
    if current_user.role == UserRole.ADMIN:
        ensure_area_access(db, current_user, permit.area_id)
        return
    if permit.applicant_id != current_user.id:
        raise HTTPException(status_code=403, detail="No permission to update this permit")


def attach_renewal_count(permit: WorkPermit) -> WorkPermit:
    permit.renewal_count = len(getattr(permit, "renewals", []) or [])
    return permit


@router.post("", response_model=WorkPermitOut, status_code=201)
async def create_permit(
    type: PermitType = Form(...),
    area_id: int = Form(...),
    responsible_person: str = Form(...),
    description: str = Form(default=""),
    previous_permit_id: Optional[int] = Form(default=None),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ensure_area_access(db, current_user, area_id)
    photo_url = await save_permit_photo(photo, current_user)
    start_time = get_permit_start_time(type)
    end_time = calculate_end_time(type, start_time)

    if previous_permit_id is not None:
        prev = get_scoped_permit(db, previous_permit_id, current_user)
        refresh_permit_status(prev)

    permit = WorkPermit(
        type=type,
        area_id=area_id,
        applicant_id=current_user.id,
        responsible_person=responsible_person,
        description=description,
        photo_url=photo_url,
        start_time=start_time,
        end_time=end_time,
        status=PermitStatus.ACTIVE,
        previous_permit_id=previous_permit_id,
    )
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return attach_renewal_count(permit)


@router.get("", response_model=List[WorkPermitOut])
def list_permits(
    status_filter: Optional[str] = None,
    area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = local_now()
    query = scoped_permit_query(db, current_user)
    if status_filter:
        query = query.filter(WorkPermit.status == status_filter)
    if area_id:
        if current_user.role == UserRole.ADMIN:
            ensure_area_access(db, current_user, area_id)
        query = query.filter(WorkPermit.area_id == area_id)
    permits = query.order_by(WorkPermit.created_at.desc()).all()

    changed = False
    for permit in permits:
        changed = refresh_permit_status(permit, now) or changed

    if changed:
        db.commit()
    return [attach_renewal_count(permit) for permit in permits]


@router.get("/warnings", response_model=List[WorkPermitWarning])
def get_warnings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    now = local_now()
    permits = scoped_permit_query(db, current_user).filter(
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
            if remaining_percent > WARNING_THRESHOLD_PERCENT:
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
    current_user: User = Depends(get_current_user),
):
    permit = get_scoped_permit(db, permit_id, current_user)
    if refresh_permit_status(permit):
        db.commit()
        db.refresh(permit)
    return attach_renewal_count(permit)


@router.post("/manual", response_model=WorkPermitOut, status_code=201)
async def create_manual_permit(
    type: PermitType = Form(...),
    area_id: int = Form(...),
    responsible_person: str = Form(...),
    description: str = Form(default=""),
    photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.ADMIN:
        ensure_area_access(db, current_user, area_id)
    else:
        area = db.query(Area.id).filter(Area.id == area_id).first()
        if not area:
            raise HTTPException(status_code=404, detail="Area not found")
    start_time = get_permit_start_time(type)
    end_time = calculate_end_time(type, start_time)
    photo_url = await save_permit_photo(photo, current_user) if photo else None

    permit = WorkPermit(
        type=type,
        area_id=area_id,
        applicant_id=current_user.id,
        responsible_person=responsible_person,
        description=description,
        photo_url=photo_url,
        start_time=start_time,
        end_time=end_time,
        status=PermitStatus.ACTIVE,
    )
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return attach_renewal_count(permit)


@router.post("/{permit_id}/photo", response_model=WorkPermitOut)
async def upload_permit_photo(
    permit_id: int,
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    permit = get_scoped_permit(db, permit_id, current_user)
    ensure_permit_write_access(db, permit, current_user)
    permit.photo_url = await save_permit_photo(photo, current_user)
    db.commit()
    db.refresh(permit)
    return attach_renewal_count(permit)


@router.post("/{permit_id}/renew", response_model=WorkPermitOut)
async def renew_permit(
    permit_id: int,
    photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    permit = get_scoped_permit(db, permit_id, current_user)
    ensure_permit_write_access(db, permit, current_user)
    start_time = get_permit_start_time(permit.type)
    old_start_time = permit.start_time
    old_end_time = permit.end_time
    old_photo_url = permit.photo_url
    new_photo_url = old_photo_url
    if photo:
        new_photo_url = await save_permit_photo(photo, current_user)

    permit.start_time = start_time
    permit.end_time = calculate_end_time(permit.type, start_time)
    permit.status = PermitStatus.ACTIVE
    permit.photo_url = new_photo_url
    db.add(
        WorkPermitRenewal(
            permit_id=permit.id,
            operator_id=current_user.id,
            old_start_time=old_start_time,
            old_end_time=old_end_time,
            new_start_time=permit.start_time,
            new_end_time=permit.end_time,
            old_photo_url=old_photo_url,
            new_photo_url=new_photo_url,
            created_at=datetime.now(),
        )
    )
    db.commit()
    db.refresh(permit)
    return attach_renewal_count(permit)


@router.get("/{permit_id}/renewals", response_model=list[WorkPermitRenewalOut])
def list_permit_renewals(
    permit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    permit = get_scoped_permit(db, permit_id, current_user)
    return (
        db.query(WorkPermitRenewal)
        .filter(WorkPermitRenewal.permit_id == permit.id)
        .order_by(WorkPermitRenewal.created_at.desc())
        .all()
    )


@router.delete("/{permit_id}")
def delete_permit(
    permit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    permit = get_scoped_permit(db, permit_id, current_user)
    db.delete(permit)
    db.commit()
    return {"message": "Permit deleted"}
