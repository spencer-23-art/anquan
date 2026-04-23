import os
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User, UserRole
from app.models.task import Task, ChecklistItem, TaskStatus, CheckItemStatus, Severity
from app.schemas.task import TaskCreate, TaskOut, TaskFromAI
from app.config import settings

router = APIRouter(prefix="/api/tasks", tags=["任务管理"])


async def read_limited_upload(upload: UploadFile) -> bytes:
    content = await upload.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Upload too large. Max {settings.MAX_UPLOAD_SIZE // 1024}KB",
        )
    return content


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """创建巡查任务 (管理员)"""
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
        item = ChecklistItem(
            task_id=task.id,
            risk_description=item_data.risk_description,
            measure=item_data.measure,
            severity=item_data.severity,
        )
        db.add(item)

    db.commit()
    db.refresh(task)
    return db.query(Task).options(joinedload(Task.checklist_items)).filter(Task.id == task.id).first()


@router.post("/from-ai", response_model=TaskOut, status_code=201)
def create_task_from_ai(
    data: TaskFromAI,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """从 AI 生成的清单创建任务"""
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
        item = ChecklistItem(
            task_id=task.id,
            risk_description=item_data.risk_description,
            measure=item_data.measure,
            severity=item_data.severity,
        )
        db.add(item)

    db.commit()
    db.refresh(task)
    return db.query(Task).options(joinedload(Task.checklist_items)).filter(Task.id == task.id).first()


@router.get("", response_model=List[TaskOut])
def list_tasks(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取任务列表 (管理员看全部, 巡查员只看自己的)"""
    q = db.query(Task).options(
        joinedload(Task.checklist_items),
        joinedload(Task.area),
        joinedload(Task.assignee),
        joinedload(Task.associated_permits)
    )
    if current_user.role != UserRole.ADMIN:
        q = q.filter(Task.assignee_id == current_user.id)
    if status_filter:
        q = q.filter(Task.status == status_filter)
    return q.order_by(Task.created_at.desc()).all()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).options(
        joinedload(Task.checklist_items),
        joinedload(Task.area),
        joinedload(Task.assignee),
        joinedload(Task.associated_permits)
    ).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != UserRole.ADMIN and task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")
    return task


@router.post("/{task_id}/items/{item_id}/check")
async def check_item(
    task_id: int,
    item_id: int,
    note: str = Form(default=""),
    photo: UploadFile = File(..., description="现场拍照 (必须)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    巡查员打卡: 完成某条检查项 (强制拍照上传)
    """
    item = db.query(ChecklistItem).filter(
        ChecklistItem.id == item_id,
        ChecklistItem.task_id == task_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="检查项不存在")

    task = db.query(Task).filter(Task.id == task_id).first()
    if task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="你不是该任务的指派人")

    # 验证文件类型
    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="必须上传图片文件")

    # 保存照片
    upload_dir = os.path.join(settings.UPLOAD_DIR, "checklist", str(task_id))
    os.makedirs(upload_dir, exist_ok=True)
    ext = photo.filename.split(".")[-1] if photo.filename else "jpg"
    filename = f"{item_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await read_limited_upload(photo)
    with open(filepath, "wb") as f:
        f.write(content)

    # 更新检查项
    item.status = CheckItemStatus.CHECKED
    item.photo_url = f"/uploads/checklist/{task_id}/{filename}"
    item.note = note
    item.checked_at = datetime.utcnow()
    db.commit()

    # 检查是否所有项都完成
    total = db.query(ChecklistItem).filter(ChecklistItem.task_id == task_id).count()
    checked = db.query(ChecklistItem).filter(
        ChecklistItem.task_id == task_id,
        ChecklistItem.status == CheckItemStatus.CHECKED,
    ).count()

    if checked == total:
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        db.commit()

@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """(管理员) 物理删除任务及关联核查项"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    db.delete(task)
    db.commit()
    return {"message": "任务已成功删除"}
