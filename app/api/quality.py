import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.ai_analysis_history import AIAnalysisHistory
from app.models.task import ChecklistItem, Severity, Task
from app.models.user import User
from app.schemas.system_config import (
    AIAnalysisHistoryOut,
    AIChatMessage,
    AIChatResponse,
    AICreateTaskRequest,
)
from app.services import quality_inquiry
from app.services.area_scope import ensure_area_access, managed_area_ids
from app.services.task_context import build_task_description, clean_task_context_text, resolve_project_name

router = APIRouter(prefix="/api/quality", tags=["quality"])
AI_HISTORY_RETENTION_DAYS = 30
QUALITY_MODULE = "quality"


def local_now() -> datetime:
    return datetime.now()


def _cleanup_history(db: Session) -> None:
    cutoff = local_now() - timedelta(days=AI_HISTORY_RETENTION_DAYS)
    db.query(AIAnalysisHistory).filter(
        AIAnalysisHistory.module == QUALITY_MODULE,
        AIAnalysisHistory.created_at < cutoff,
    ).delete(synchronize_session=False)


def _history_payload_for_response(history: AIAnalysisHistory) -> dict:
    try:
        payload = json.loads(history.payload)
    except json.JSONDecodeError:
        payload = {"type": "checklist", "summary": history.title, "items": [], "permits": []}

    payload["type"] = payload.get("type") or "checklist"
    payload["summary"] = payload.get("summary") or history.title
    payload["items"] = payload.get("items") or []
    payload["permits"] = []
    return payload


def _history_out(history: AIAnalysisHistory) -> AIAnalysisHistoryOut:
    payload = _history_payload_for_response(history)
    return AIAnalysisHistoryOut(
        id=history.id,
        session_id=history.ai_session_id,
        title=history.title,
        area_id=history.area_id,
        area_name=history.area.name if history.area else None,
        creator_name=history.creator.real_name if history.creator else None,
        item_count=len(payload.get("items", [])),
        permit_count=0,
        created_at=history.created_at,
        payload=payload,
    )


def _save_quality_history(
    db: Session,
    *,
    session_id: str,
    area_id: int,
    creator_id: int,
    payload: dict,
) -> None:
    title = str(payload.get("summary") or "AI 生成质量控制任务").strip()[:200]
    _cleanup_history(db)
    db.add(
        AIAnalysisHistory(
            title=title,
            area_id=area_id,
            creator_id=creator_id,
            ai_session_id=session_id,
            module=QUALITY_MODULE,
            payload=json.dumps(payload, ensure_ascii=False),
        )
    )


@router.get("/history", response_model=list[AIAnalysisHistoryOut])
def list_quality_analysis_history(
    area_id: int | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cutoff = local_now() - timedelta(days=AI_HISTORY_RETENTION_DAYS)
    _cleanup_history(db)
    db.commit()

    query = db.query(AIAnalysisHistory).filter(
        AIAnalysisHistory.module == QUALITY_MODULE,
        AIAnalysisHistory.created_at >= cutoff,
    )
    allowed_ids = managed_area_ids(db, current_user)
    if area_id:
        ensure_area_access(db, current_user, area_id)
        query = query.filter(AIAnalysisHistory.area_id == area_id)
    elif allowed_ids is not None:
        query = query.filter(AIAnalysisHistory.area_id.in_(allowed_ids))

    histories = (
        query.order_by(AIAnalysisHistory.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [_history_out(history) for history in histories]


@router.delete("/history/{history_id}")
def delete_quality_analysis_history(
    history_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = (
        db.query(AIAnalysisHistory)
        .filter(
            AIAnalysisHistory.id == history_id,
            AIAnalysisHistory.module == QUALITY_MODULE,
        )
        .first()
    )
    if not history:
        raise HTTPException(status_code=404, detail="Quality history not found")

    ensure_area_access(db, current_user, history.area_id)
    db.delete(history)
    db.commit()
    return {"message": "Quality history deleted"}


@router.post("/chat", response_model=AIChatResponse)
def quality_chat(
    data: AIChatMessage,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        session_id, response_type, content = quality_inquiry.chat(
            session_id=data.session_id,
            user_message=data.message,
            db=db,
            provider_id=data.provider_id,
        )
        if response_type == "checklist" and data.area_id:
            ensure_area_access(db, current_user, data.area_id)
            parsed = json.loads(content)
            parsed["permits"] = []
            _save_quality_history(
                db,
                session_id=session_id,
                area_id=data.area_id,
                creator_id=current_user.id,
                payload=parsed,
            )
            content = json.dumps(parsed, ensure_ascii=False)
            db.commit()
        return AIChatResponse(
            session_id=session_id,
            type=response_type,
            content=content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Quality AI service error: {exc}") from exc


@router.post("/create-task")
def create_task_from_quality_ai(
    data: AICreateTaskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title = data.title
    items = data.items or []

    if not title or not items:
        checklist = quality_inquiry.get_last_checklist(data.session_id)
        if not checklist:
            raise HTTPException(status_code=400, detail="No quality checklist found for this session")
        title = title or checklist.get("summary") or "AI generated quality task"
        items = items or checklist.get("items", [])

    if not items:
        raise HTTPException(status_code=400, detail="Quality checklist items are required")

    try:
        ensure_area_access(db, current_user, data.area_id)
        assignee = db.query(User).filter(User.id == data.assignee_id).first()
        if not assignee:
            raise HTTPException(status_code=404, detail="Assignee not found")
        project_name = resolve_project_name(db, data.area_id, data.project_name)
        work_point = clean_task_context_text(data.work_point)
        process_name = clean_task_context_text(data.process_name)

        task = Task(
            title=title,
            description=build_task_description("Generated from quality AI session", data.session_id, work_point, process_name),
            area_id=data.area_id,
            project_name=project_name,
            work_point=work_point,
            process_name=process_name,
            assignee_id=data.assignee_id,
            creator_id=current_user.id,
            ai_session_id=data.session_id,
            required_permits=json.dumps([], ensure_ascii=False),
        )
        db.add(task)
        db.flush()

        for item in items:
            severity_value = item.get("severity", Severity.MEDIUM)
            if isinstance(severity_value, str):
                severity_value = Severity(severity_value)
            db.add(
                ChecklistItem(
                    task_id=task.id,
                    risk_description=item.get("risk_description", ""),
                    inspection_points=item.get("inspection_points"),
                    photo_requirements=item.get("photo_requirements"),
                    measure=item.get("measure"),
                    severity=severity_value,
                )
            )

        db.commit()
        return {
            "message": "Quality task created",
            "task_id": task.id,
            "permit_count": 0,
            "suppressed_permit_count": 0,
            "suppressed_permits": [],
        }
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid severity: {exc}") from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create quality task: {exc}") from exc
