from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.area import Area
from app.models.fine_ticket import FineTicket
from app.models.task import Task
from app.models.user import User
from app.models.work_permit import WorkPermit
from app.schemas.area import AreaCreate, AreaOut, AreaUpdate
from app.services.area_scope import collect_descendant_area_ids, ensure_area_access, managed_area_ids

router = APIRouter(prefix="/api/areas", tags=["areas"])


@router.get("", response_model=List[AreaOut])
def list_areas(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(Area)
    allowed_ids = managed_area_ids(db, current_user)
    if allowed_ids is not None:
        query = query.filter(Area.id.in_(allowed_ids))
    return query.order_by(Area.parent_id.isnot(None), Area.name).all()


@router.post("", response_model=AreaOut, status_code=201)
def create_area(
    data: AreaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(Area).filter(Area.name == data.name, Area.parent_id == data.parent_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Area name already exists")

    if data.parent_id:
        parent = db.query(Area).filter(Area.id == data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent area not found")
        ensure_area_access(db, current_user, data.parent_id)

    area = Area(**data.model_dump())
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

    if data.parent_id:
        if data.parent_id == area.id:
            raise HTTPException(status_code=400, detail="Area cannot be its own parent")
        if data.parent_id in collect_descendant_area_ids(db, area.id):
            raise HTTPException(status_code=400, detail="Area cannot be moved under its own child area")
        parent = db.query(Area).filter(Area.id == data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent area not found")
        ensure_area_access(db, current_user, data.parent_id)

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(area, key, value)
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
    area_ids = collect_descendant_area_ids(db, area.id)
    task_count = db.query(Task).filter(Task.area_id.in_(area_ids)).count()
    permit_count = db.query(WorkPermit).filter(WorkPermit.area_id.in_(area_ids)).count()
    fine_count = db.query(FineTicket).filter(FineTicket.area_id.in_(area_ids)).count()
    manager_count = db.query(User).filter(User.managed_area_id.in_(area_ids)).count()
    if task_count or permit_count or fine_count or manager_count:
        raise HTTPException(
            status_code=400,
            detail="区域已有任务、票证或管理员权限，不能直接删除；可以先把它归入项目，保留原有数据。",
        )
    db.delete(area)
    db.commit()
