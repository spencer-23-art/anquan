from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.area import Area
from app.models.user import User
from app.schemas.area import AreaCreate, AreaOut, AreaUpdate

router = APIRouter(prefix="/api/areas", tags=["区域管理"])


@router.get("", response_model=List[AreaOut])
def list_areas(db: Session = Depends(get_db)):
    return db.query(Area).order_by(Area.name).all()


@router.post("", response_model=AreaOut, status_code=201)
def create_area(
    data: AreaCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = db.query(Area).filter(Area.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="区域名称已存在")
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
    _admin: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="区域不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(area, k, v)
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=204)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="区域不存在")
    db.delete(area)
    db.commit()
