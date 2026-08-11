from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.models.area import Area
from app.models.fine_ticket import FineTicket
from app.models.task import Task
from app.models.user import User
from app.models.work_permit import WorkPermit
from app.schemas.area import AreaCreate, AreaOut, AreaUpdate
from app.services.area_scope import collect_descendant_area_ids, ensure_area_access, is_super_admin, managed_area_ids

router = APIRouter(prefix="/api/areas", tags=["areas"])


def _clean_name(name: str) -> str:
    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Area name is required")
    if len(cleaned) > 100:
        raise HTTPException(status_code=400, detail="Area name is too long")
    return cleaned


def _has_sibling_name(db: Session, name: str, parent_id: int | None, exclude_id: int | None = None) -> bool:
    query = db.query(Area.id).filter(Area.name == name)
    query = query.filter(Area.parent_id.is_(None) if parent_id is None else Area.parent_id == parent_id)
    if exclude_id is not None:
        query = query.filter(Area.id != exclude_id)
    return query.first() is not None


def _ensure_active_parent(db: Session, current_user: User, parent_id: int) -> Area:
    parent = db.query(Area).filter(Area.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=400, detail="Parent area not found")
    if not parent.is_active:
        raise HTTPException(status_code=400, detail="Archived areas cannot receive new work areas")
    ensure_area_access(db, current_user, parent_id)
    return parent


@router.get("", response_model=List[AreaOut])
def list_areas(
    include_all: bool = False,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if include_inactive and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can view archived areas")

    query = db.query(Area)
    if not include_inactive:
        query = query.filter(Area.is_active.is_(True))

    allowed_ids = managed_area_ids(db, current_user)
    if allowed_ids is not None and (not include_all or not is_super_admin(current_user)):
        if not allowed_ids:
            task_area_ids = db.query(Task.area_id).filter(Task.assignee_id == current_user.id)
            permit_area_ids = db.query(WorkPermit.area_id).filter(
                (WorkPermit.applicant_id == current_user.id)
                | (WorkPermit.responsible_person == current_user.real_name)
            )
            fine_area_ids = db.query(FineTicket.area_id).filter(FineTicket.creator_id == current_user.id)
            allowed_ids = sorted(
                {
                    area_id
                    for (area_id,) in list(task_area_ids) + list(permit_area_ids) + list(fine_area_ids)
                    if area_id is not None
                }
            )
        query = query.filter(Area.id.in_(allowed_ids))
    return query.order_by(Area.parent_id.isnot(None), Area.name).all()


@router.post("", response_model=AreaOut, status_code=201)
def create_area(
    data: AreaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    name = _clean_name(data.name)
    if _has_sibling_name(db, name, data.parent_id):
        raise HTTPException(status_code=409, detail="An area with this name already exists at this level")

    if data.parent_id is not None:
        _ensure_active_parent(db, current_user, data.parent_id)

    area = Area(name=name, parent_id=data.parent_id, description=(data.description or "").strip() or None)
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@router.put("/{area_id}", response_model=AreaOut)
def update_area(
    area_id: int,
    data: AreaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    ensure_area_access(db, current_user, area.id)

    payload = data.model_dump(exclude_unset=True)
    target_parent_id = payload.get("parent_id", area.parent_id)
    target_name = _clean_name(payload["name"]) if "name" in payload else area.name

    if target_parent_id is not None:
        if target_parent_id == area.id:
            raise HTTPException(status_code=400, detail="Area cannot be its own parent")
        if target_parent_id in collect_descendant_area_ids(db, area.id):
            raise HTTPException(status_code=400, detail="Area cannot be moved under its own child area")
        _ensure_active_parent(db, current_user, target_parent_id)

    if _has_sibling_name(db, target_name, target_parent_id, exclude_id=area.id):
        raise HTTPException(status_code=409, detail="An area with this name already exists at this level")

    if payload.get("is_active") is True and target_parent_id is not None:
        parent = db.query(Area).filter(Area.id == target_parent_id).first()
        if parent and not parent.is_active:
            raise HTTPException(status_code=400, detail="Restore the parent project before restoring this area")

    area.name = target_name
    area.parent_id = target_parent_id
    if "description" in payload:
        area.description = (payload["description"] or "").strip() or None
    if "is_active" in payload:
        area.is_active = payload["is_active"]
    db.commit()
    db.refresh(area)
    return area


@router.post("/{area_id}/archive", response_model=AreaOut)
def archive_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    ensure_area_access(db, current_user, area.id)

    descendants = collect_descendant_area_ids(db, area.id)
    db.query(Area).filter(Area.id.in_(descendants)).update({Area.is_active: False}, synchronize_session=False)
    db.commit()
    db.refresh(area)
    return area


@router.post("/{area_id}/restore", response_model=AreaOut)
def restore_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    ensure_area_access(db, current_user, area.id)
    if area.parent_id is not None:
        parent = db.query(Area).filter(Area.id == area.parent_id).first()
        if parent and not parent.is_active:
            raise HTTPException(status_code=400, detail="Restore the parent project before restoring this area")

    descendants = collect_descendant_area_ids(db, area.id)
    db.query(Area).filter(Area.id.in_(descendants)).update({Area.is_active: True}, synchronize_session=False)
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=204)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    ensure_area_access(db, current_user, area.id)

    if db.query(Area.id).filter(Area.parent_id == area.id).first():
        raise HTTPException(status_code=409, detail="Move or archive child areas before deleting this area")
    task_count = db.query(Task).filter(Task.area_id == area.id).count()
    permit_count = db.query(WorkPermit).filter(WorkPermit.area_id == area.id).count()
    fine_count = db.query(FineTicket).filter(FineTicket.area_id == area.id).count()
    manager_count = db.query(User).filter(User.managed_area_id == area.id).count()
    if task_count or permit_count or fine_count or manager_count:
        raise HTTPException(
            status_code=409,
            detail="Areas with business records or assigned managers must be archived, not deleted",
        )
    db.delete(area)
    db.commit()
