from sqlalchemy.orm import Session

from app.config import settings
from app.models.area import Area
from app.models.user import User, UserRole


def is_super_admin(user: User) -> bool:
    return user.role == UserRole.ADMIN and user.username == settings.ADMIN_USERNAME


def collect_descendant_area_ids(db: Session, root_area_id: int | None) -> list[int]:
    if root_area_id is None:
        return []

    ids: list[int] = []
    pending = [root_area_id]
    while pending:
        current_id = pending.pop(0)
        if current_id in ids:
            continue
        ids.append(current_id)
        children = db.query(Area.id).filter(Area.parent_id == current_id).all()
        pending.extend(child.id for child in children)
    return ids


def managed_area_ids(db: Session, user: User) -> list[int] | None:
    if is_super_admin(user):
        return None
    if user.role not in (UserRole.ADMIN, UserRole.EXTERNAL):
        return []
    if user.managed_area_id is None:
        return None if user.role == UserRole.ADMIN else []
    return collect_descendant_area_ids(db, user.managed_area_id)


def is_area_scoped_user(user: User) -> bool:
    return user.role in (UserRole.ADMIN, UserRole.EXTERNAL)


def ensure_area_access(db: Session, user: User, area_id: int) -> None:
    allowed_ids = managed_area_ids(db, user)
    if allowed_ids is not None and area_id not in allowed_ids:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="No access to this area")
