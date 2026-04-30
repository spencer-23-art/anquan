import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.models.ai_analysis_history import AIAnalysisHistory
from app.models.system_config import SystemConfig
from app.models.task import ChecklistItem, Severity, Task
from app.models.user import User
from app.models.work_permit import WARNING_THRESHOLD_PERCENT, PermitStatus, PermitType, WorkPermit
from app.schemas.system_config import (
    AIAnalysisHistoryOut,
    AIChatMessage,
    AIChatResponse,
    AICreateTaskRequest,
    AIRuntimeConfigOut,
    SystemConfigOut,
    SystemConfigUpdate,
)
from app.services import ai_config_service
from app.services import risk_inquiry
from app.services.area_scope import ensure_area_access, managed_area_ids

router = APIRouter(prefix="/api/ai", tags=["ai"])


def local_now() -> datetime:
    return datetime.now()


def get_workday_start(now: datetime | None = None) -> datetime:
    current = now or local_now()
    return current.replace(hour=7, minute=0, second=0, microsecond=0)


def _remaining_percent(permit: WorkPermit, now: datetime) -> float:
    if not permit.start_time or not permit.end_time:
        return 0.0
    total_seconds = (permit.end_time - permit.start_time).total_seconds()
    remaining_seconds = (permit.end_time - now).total_seconds()
    if total_seconds <= 0 or remaining_seconds <= 0:
        return 0.0
    return remaining_seconds / total_seconds * 100


def _filter_permits_by_area_validity(
    db: Session,
    *,
    area_id: int | None,
    permits: list,
) -> tuple[list, list[dict]]:
    if not area_id or not permits:
        return permits, []

    now = local_now()
    def permit_value(permit) -> str | None:
        if isinstance(permit, dict):
            return permit.get("type")
        return getattr(permit, "type", None)

    def append_reason(permit, extra: str) -> None:
        if isinstance(permit, dict):
            permit["reason"] = f"{permit.get('reason') or ''} {extra}".strip()
        elif hasattr(permit, "reason"):
            permit.reason = f"{permit.reason or ''} {extra}".strip()

    permit_types = [PermitType(value) for permit in permits if (value := permit_value(permit))]
    if not permit_types:
        return permits, []

    existing_permits = (
        db.query(WorkPermit)
        .filter(
            WorkPermit.area_id == area_id,
            WorkPermit.type.in_(permit_types),
            WorkPermit.photo_url.isnot(None),
            WorkPermit.status.in_([PermitStatus.ACTIVE, PermitStatus.WARNING]),
        )
        .all()
    )

    active_by_type: dict[PermitType, WorkPermit] = {}
    warning_by_type: dict[PermitType, WorkPermit] = {}
    for existing in existing_permits:
        remaining = _remaining_percent(existing, now)
        if remaining <= 0:
            continue
        if remaining > WARNING_THRESHOLD_PERCENT:
            current = active_by_type.get(existing.type)
            if not current or (existing.end_time and current.end_time and existing.end_time > current.end_time):
                active_by_type[existing.type] = existing
        else:
            current = warning_by_type.get(existing.type)
            if not current or (existing.end_time and current.end_time and existing.end_time < current.end_time):
                warning_by_type[existing.type] = existing

    filtered = []
    suppressed: list[dict] = []
    for permit in permits:
        permit_type = PermitType(permit_value(permit))
        active_permit = active_by_type.get(permit_type)
        if active_permit:
            suppressed.append(
                {
                    "type": permit_value(permit),
                    "existing_permit_id": active_permit.id,
                    "end_time": active_permit.end_time.isoformat() if active_permit.end_time else None,
                    "remaining_percent": round(_remaining_percent(active_permit, now), 1),
                }
            )
            continue

        warning_permit = warning_by_type.get(permit_type)
        if warning_permit:
            append_reason(
                permit,
                f"同区域已有该类票证但剩余有效期不超过{WARNING_THRESHOLD_PERCENT}%，需要继续提醒续票或重新办票。",
            )
        filtered.append(permit)

    return filtered, suppressed


def _history_payload_for_response(db: Session, history: AIAnalysisHistory) -> dict:
    try:
        payload = json.loads(history.payload)
    except json.JSONDecodeError:
        payload = {"type": "checklist", "summary": history.title, "items": [], "permits": []}

    payload["type"] = payload.get("type") or "checklist"
    payload["summary"] = payload.get("summary") or history.title
    filtered_permits, suppressed_permits = _filter_permits_by_area_validity(
        db,
        area_id=history.area_id,
        permits=[dict(permit) for permit in payload.get("permits", [])],
    )
    payload["permits"] = filtered_permits
    payload["suppressed_permits"] = suppressed_permits
    return payload


def _history_out(db: Session, history: AIAnalysisHistory) -> AIAnalysisHistoryOut:
    payload = _history_payload_for_response(db, history)
    return AIAnalysisHistoryOut(
        id=history.id,
        session_id=history.ai_session_id,
        title=history.title,
        area_id=history.area_id,
        area_name=history.area.name if history.area else None,
        creator_name=history.creator.real_name if history.creator else None,
        item_count=len(payload.get("items", [])),
        permit_count=len(payload.get("permits", [])),
        created_at=history.created_at,
        payload=payload,
    )


def _save_analysis_history(
    db: Session,
    *,
    session_id: str,
    area_id: int,
    creator_id: int,
    payload: dict,
) -> None:
    title = str(payload.get("summary") or "AI 生成作业任务").strip()[:200]
    db.add(
        AIAnalysisHistory(
            title=title,
            area_id=area_id,
            creator_id=creator_id,
            ai_session_id=session_id,
            payload=json.dumps(payload, ensure_ascii=False),
        )
    )


@router.get("/config", response_model=SystemConfigOut)
def get_ai_config(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    providers, active_provider_id = ai_config_service.list_provider_summaries(
        db,
        include_secrets=False,
    )
    active_provider = next(
        (item for item in providers if item["id"] == active_provider_id),
        providers[0] if providers else None,
    )

    return SystemConfigOut(
        ai_base_url=active_provider.get("base_url") if active_provider else None,
        ai_api_key_masked=active_provider.get("api_key_masked") if active_provider else None,
        ai_model=active_provider.get("model") if active_provider else None,
        active_provider_id=active_provider_id,
        providers=providers,
    )


@router.get("/runtime-config", response_model=AIRuntimeConfigOut)
def get_ai_runtime_config(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    providers, active_provider_id = ai_config_service.list_provider_summaries(
        db,
        include_secrets=False,
    )
    active_provider = next(
        (item for item in providers if item["id"] == active_provider_id),
        providers[0] if providers else None,
    )
    return AIRuntimeConfigOut(
        ai_base_url=active_provider.get("base_url") if active_provider else None,
        ai_model=active_provider.get("model") if active_provider else None,
        active_provider_id=active_provider_id,
        providers=providers,
    )


@router.put("/config")
def update_ai_config(
    data: SystemConfigUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if data.providers is not None:
        ai_config_service.save_provider_configs(
            db,
            [provider.model_dump() for provider in data.providers],
            data.active_provider_id,
        )
        return {"message": "AI config updated"}

    providers, active_provider_id = ai_config_service.load_provider_configs(db)
    active_provider = None
    if active_provider_id:
        active_provider = next((item for item in providers if item["id"] == active_provider_id), None)
    if not active_provider:
        active_provider = providers[0] if providers else {
            "id": "default",
            "name": "默认接口",
            "base_url": "",
            "api_key": "",
            "model": "deepseek-ai/DeepSeek-V3",
            "enabled": True,
        }

    updated_provider = {
        **active_provider,
        "base_url": data.ai_base_url if data.ai_base_url is not None else active_provider.get("base_url", ""),
        "model": data.ai_model if data.ai_model is not None else active_provider.get("model", ""),
        "enabled": True,
    }
    if data.ai_api_key:
        updated_provider["api_key"] = data.ai_api_key
    else:
        updated_provider["api_key"] = active_provider.get("api_key", "")

    remaining = [item for item in providers if item["id"] != updated_provider["id"]]
    ai_config_service.save_provider_configs(
        db,
        [updated_provider, *remaining],
        data.active_provider_id or updated_provider["id"],
    )
    return {"message": "AI config updated"}


@router.get("/history", response_model=list[AIAnalysisHistoryOut])
def list_ai_analysis_history(
    area_id: int | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AIAnalysisHistory)
    allowed_ids = managed_area_ids(db, current_user)
    if area_id:
        ensure_area_access(db, current_user, area_id)
        query = query.filter(AIAnalysisHistory.area_id == area_id)
    elif allowed_ids is not None:
        query = query.filter(AIAnalysisHistory.area_id.in_(allowed_ids))

    histories = (
        query.order_by(AIAnalysisHistory.created_at.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [_history_out(db, history) for history in histories]


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(
    data: AIChatMessage,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        session_id, response_type, content = risk_inquiry.chat(
            session_id=data.session_id,
            user_message=data.message,
            db=db,
            provider_id=data.provider_id,
        )
        if response_type == "checklist" and data.area_id:
            ensure_area_access(db, current_user, data.area_id)
            parsed = json.loads(content)
            _save_analysis_history(
                db,
                session_id=session_id,
                area_id=data.area_id,
                creator_id=current_user.id,
                payload=parsed,
            )
            filtered_permits, suppressed_permits = _filter_permits_by_area_validity(
                db,
                area_id=data.area_id,
                permits=parsed.get("permits", []),
            )
            parsed["permits"] = filtered_permits
            if suppressed_permits:
                parsed["suppressed_permits"] = suppressed_permits
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
        raise HTTPException(status_code=500, detail=f"AI service error: {exc}") from exc


@router.post("/create-task")
def create_task_from_ai(
    data: AICreateTaskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title = data.title
    items = data.items or []

    if not title or not items:
        checklist = risk_inquiry.get_last_checklist(data.session_id)
        if not checklist:
            raise HTTPException(status_code=400, detail="No checklist found for this session")
        title = title or checklist.get("summary") or "AI generated task"
        items = items or checklist.get("items", [])

    if not items:
        raise HTTPException(status_code=400, detail="Checklist items are required")

    try:
        ensure_area_access(db, current_user, data.area_id)
        assignee = db.query(User).filter(User.id == data.assignee_id).first()
        if not assignee:
            raise HTTPException(status_code=404, detail="Assignee not found")
        filtered_permits, _suppressed_permits = _filter_permits_by_area_validity(
            db,
            area_id=data.area_id,
            permits=data.permits or [],
        )
        for permit in filtered_permits:
            PermitType(permit.type)

        task = Task(
            title=title,
            description=f"Generated from AI session {data.session_id}",
            area_id=data.area_id,
            assignee_id=data.assignee_id,
            creator_id=current_user.id,
            ai_session_id=data.session_id,
            required_permits=json.dumps(
                [permit.model_dump() for permit in filtered_permits],
                ensure_ascii=False,
            ),
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
            "message": "Task created",
            "task_id": task.id,
            "permit_count": len(filtered_permits),
        }
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid severity or permit type: {exc}") from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create task: {exc}") from exc
