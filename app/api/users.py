from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.config import settings
from app.models.area import Area
from app.models.user import User, UserRole, UserStatus
from app.schemas.user import UserOut, UserPermissionUpdate
from app.services.area_scope import ensure_area_access, is_super_admin

router = APIRouter(prefix="/api/users", tags=["users"])


def require_super_admin(current_user: User) -> None:
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can manage users")


@router.get("", response_model=List[UserOut])
def list_users(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    query = db.query(User)
    if status_filter:
        query = query.filter(User.status == status_filter)
    return query.order_by(User.created_at.desc()).all()


@router.get("/pending", response_model=List[UserOut])
def list_pending_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    return (
        db.query(User)
        .filter(User.status == UserStatus.PENDING)
        .order_by(User.created_at.desc())
        .all()
    )


@router.put("/{user_id}/approve", response_model=UserOut)
@router.post("/{user_id}/approve", response_model=UserOut)
def approve_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.APPROVED
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/reject", response_model=UserOut)
@router.post("/{user_id}/reject", response_model=UserOut)
def reject_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.REJECTED
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/permissions", response_model=UserOut)
def update_user_permissions(
    user_id: int,
    data: UserPermissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.managed_area_id:
        area = db.query(Area).filter(Area.id == data.managed_area_id).first()
        if not area:
            raise HTTPException(status_code=400, detail="Managed area not found")
        ensure_area_access(db, current_user, data.managed_area_id)
    if data.role == UserRole.ADMIN and user.username != settings.ADMIN_USERNAME and not data.managed_area_id:
        raise HTTPException(status_code=400, detail="Admin users must have a managed area")

    user.role = data.role
    user.managed_area_id = data.managed_area_id if data.role == UserRole.ADMIN else None
    if data.status:
        user.status = data.status

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    require_super_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}
