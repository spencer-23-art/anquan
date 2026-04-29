import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db, require_admin
from app.config import settings
from app.models.task import CheckItemStatus, ChecklistItem, Task, TaskStatus
from app.models.user import User, UserRole
from app.schemas.task import TaskCreate, TaskFromAI, TaskOut
from app.services.area_scope import ensure_area_access, managed_area_ids

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


async def read_limited_upload(upload: UploadFile) -> bytes:
    content = await upload.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Upload too large. Max {settings.MAX_UPLOAD_SIZE // 1024}KB",
        )
    return content


def task_query(db: Session):
    return db.query(Task).options(
        joinedload(Task.checklist_items),
        joinedload(Task.area),
        joinedload(Task.assignee),
        joinedload(Task.associated_permits),
    )


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ensure_area_access(db, current_user, data.area_id)
    task = Task(
        title=data.title,
        description=data.description,
        area_id=data.area_id,
        assignee_id=data.assignee_id,
        creator_id=current_user.id,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    db.flush()

    for item_data in data.checklist_items:
        db.add(
            ChecklistItem(
                task_id=task.id,
                risk_description=item_data.risk_description,
                inspection_points=item_data.inspection_points,
                photo_requirements=item_data.photo_requirements,
                measure=item_data.measure,
                severity=item_data.severity,
            )
        )

    db.commit()
    return task_query(db).filter(Task.id == task.id).first()


@router.post("/from-ai", response_model=TaskOut, status_code=201)
def create_task_from_ai(
    data: TaskFromAI,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ensure_area_access(db, current_user, data.area_id)
    task = Task(
        title=data.title,
        description=data.description,
        area_id=data.area_id,
        assignee_id=data.assignee_id,
        creator_id=current_user.id,
        status=TaskStatus.PENDING,
        ai_session_id=data.session_id,
    )
    db.add(task)
    db.flush()

    for item_data in data.checklist_items:
        db.add(
            ChecklistItem(
                task_id=task.id,
                risk_description=item_data.risk_description,
                inspection_points=item_data.inspection_points,
                photo_requirements=item_data.photo_requirements,
                measure=item_data.measure,
                severity=item_data.severity,
            )
        )

    db.commit()
    return task_query(db).filter(Task.id == task.id).first()


@router.get("", response_model=List[TaskOut])
def list_tasks(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = task_query(db)
    if current_user.role != UserRole.ADMIN:
        query = query.filter(Task.assignee_id == current_user.id)
    else:
        allowed_ids = managed_area_ids(db, current_user)
        if allowed_ids is not None:
            query = query.filter(Task.area_id.in_(allowed_ids))
    if status_filter:
        query = query.filter(Task.status == status_filter)
    return query.order_by(Task.created_at.desc()).all()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = task_query(db).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role != UserRole.ADMIN and task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="No access to this task")
    if current_user.role == UserRole.ADMIN:
        ensure_area_access(db, current_user, task.area_id)
    return task


@router.post("/{task_id}/items/{item_id}/check")
async def check_item(
    task_id: int,
    item_id: int,
    note: str = Form(default=""),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.id == item_id, ChecklistItem.task_id == task_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="No access to this task")

    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo must be an image")

    upload_dir = os.path.join(settings.UPLOAD_DIR, "checklist", str(task_id))
    os.makedirs(upload_dir, exist_ok=True)
    ext = photo.filename.rsplit(".", 1)[-1] if photo.filename and "." in photo.filename else "jpg"
    filename = f"{item_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}.{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await read_limited_upload(photo)
    with open(filepath, "wb") as file_obj:
        file_obj.write(content)

    item.status = CheckItemStatus.CHECKED
    item.photo_url = f"/uploads/checklist/{task_id}/{filename}"
    item.note = note
    item.checked_at = datetime.utcnow()
    db.commit()

    total = db.query(ChecklistItem).filter(ChecklistItem.task_id == task_id).count()
    checked = (
        db.query(ChecklistItem)
        .filter(ChecklistItem.task_id == task_id, ChecklistItem.status == CheckItemStatus.CHECKED)
        .count()
    )

    if checked == total:
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        db.commit()

    return {"message": "Checklist item checked"}


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_area_access(db, current_user, task.area_id)

    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}
