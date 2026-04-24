from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.models.system_config import SystemConfig
from app.models.task import ChecklistItem, Severity, Task
from app.models.user import User
from app.models.work_permit import PERMIT_DURATION_HOURS, PermitStatus, PermitType, WorkPermit
from app.schemas.system_config import (
    AIChatMessage,
    AIChatResponse,
    AICreateTaskRequest,
    AIRuntimeConfigOut,
    SystemConfigOut,
    SystemConfigUpdate,
)
from app.services import ai_config_service
from app.services import risk_inquiry
from app.services.area_scope import ensure_area_access

router = APIRouter(prefix="/api/ai", tags=["ai"])


def local_now() -> datetime:
    return datetime.now()


def get_workday_start(now: datetime | None = None) -> datetime:
    current = now or local_now()
    return current.replace(hour=7, minute=0, second=0, microsecond=0)


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


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(
    data: AIChatMessage,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    try:
        session_id, response_type, content = risk_inquiry.chat(
            session_id=data.session_id,
            user_message=data.message,
            db=db,
            provider_id=data.provider_id,
        )
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

        task = Task(
            title=title,
            description=f"Generated from AI session {data.session_id}",
            area_id=data.area_id,
            assignee_id=data.assignee_id,
            creator_id=current_user.id,
            ai_session_id=data.session_id,
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
                    measure=item.get("measure"),
                    severity=severity_value,
                )
            )

        for permit in data.permits or []:
            permit_type = PermitType(permit.type)
            start_time = get_workday_start()
            end_time = start_time + timedelta(
                hours=PERMIT_DURATION_HOURS.get(permit_type, 8)
            )
            db.add(
                WorkPermit(
                    type=permit_type,
                    area_id=data.area_id,
                    applicant_id=current_user.id,
                    responsible_person=assignee.real_name,
                    description=f"AI 风险分析会话 {data.session_id} 自动生成",
                    photo_url=permit.photo_url,
                    start_time=start_time,
                    end_time=end_time,
                    status=PermitStatus.ACTIVE,
                    task_id=task.id,
                )
            )

        db.commit()
        return {
            "message": "Task created",
            "task_id": task.id,
            "permit_count": len(data.permits or []),
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
