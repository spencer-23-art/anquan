import json
import re
from difflib import SequenceMatcher
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.models.ai_analysis_history import AIAnalysisHistory
from app.models.area import Area
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
AI_HISTORY_RETENTION_DAYS = 30


def local_now() -> datetime:
    return datetime.now()


def get_workday_start(now: datetime | None = None) -> datetime:
    current = now or local_now()
    return current.replace(hour=8, minute=0, second=0, microsecond=0)


def _remaining_percent(permit: WorkPermit, now: datetime) -> float:
    if not permit.start_time or not permit.end_time:
        return 0.0
    total_seconds = (permit.end_time - permit.start_time).total_seconds()
    remaining_seconds = (permit.end_time - now).total_seconds()
    if total_seconds <= 0 or remaining_seconds <= 0:
        return 0.0
    return remaining_seconds / total_seconds * 100


def _permit_field(permit, field: str) -> str:
    if isinstance(permit, dict):
        return str(permit.get(field) or "").strip()
    return str(getattr(permit, field, "") or "").strip()


def _permit_scope_text(permit) -> str:
    return _permit_field(permit, "description")


def _normalize_scope(text: str) -> str:
    return "".join(char for char in str(text or "").lower() if char.isalnum())


PERMIT_FAMILY_RANKS: dict[str, dict[PermitType, int]] = {
    "height": {
        PermitType.HEIGHT_LEVEL1: 1,
        PermitType.HEIGHT_LEVEL2: 2,
        PermitType.HEIGHT_LEVEL3: 3,
        PermitType.HEIGHT_SPECIAL: 4,
    },
    "hot_work": {
        PermitType.HOT_WORK_LEVEL3: 1,
        PermitType.HOT_WORK_LEVEL2: 2,
        PermitType.HOT_WORK_LEVEL1: 3,
    },
}

PERMIT_LABELS: dict[PermitType, str] = {
    PermitType.CONFINED_SPACE: "受限空间作业票",
    PermitType.HEIGHT_LEVEL1: "一级高处作业票",
    PermitType.HEIGHT_LEVEL2: "二级高处作业票",
    PermitType.HEIGHT_LEVEL3: "三级高处作业票",
    PermitType.HEIGHT_SPECIAL: "特级高处作业票",
    PermitType.HOT_WORK_LEVEL1: "一级动火作业票",
    PermitType.HOT_WORK_LEVEL2: "二级动火作业票",
    PermitType.HOT_WORK_LEVEL3: "普通动火作业票",
    PermitType.LIFTING: "吊装作业票",
    PermitType.EXCAVATION: "动土作业票",
    PermitType.ELECTRICAL: "临时用电作业票",
    PermitType.OTHER: "其他作业票",
}


def _permit_type_enum(permit) -> PermitType | None:
    value = permit.get("type") if isinstance(permit, dict) else getattr(permit, "type", None)
    if not value:
        return None
    return value if isinstance(value, PermitType) else PermitType(value)


def _permit_family(permit_type: PermitType | None) -> str:
    if permit_type in PERMIT_FAMILY_RANKS["height"]:
        return "height"
    if permit_type in PERMIT_FAMILY_RANKS["hot_work"]:
        return "hot_work"
    return permit_type.value if permit_type else ""


def _permit_rank(permit_type: PermitType | None) -> int:
    if not permit_type:
        return 0
    family = _permit_family(permit_type)
    return PERMIT_FAMILY_RANKS.get(family, {}).get(permit_type, 1)


def _permit_covers(existing_type: PermitType | None, requested_type: PermitType | None) -> bool:
    if not existing_type or not requested_type:
        return False
    existing_family = _permit_family(existing_type)
    requested_family = _permit_family(requested_type)
    if existing_family != requested_family:
        return False
    return _permit_rank(existing_type) >= _permit_rank(requested_type)


def _permit_label(permit_type: PermitType | None) -> str:
    if not permit_type:
        return ""
    return PERMIT_LABELS.get(permit_type, permit_type.value)


def _is_same_work_scope(new_permit, existing_permit: WorkPermit) -> bool:
    """Only reuse permits for the same work point, not merely the same permit type."""
    raw_new_scope = re.sub(r"\s+", "", _permit_scope_text(new_permit))
    raw_existing_scope = re.sub(r"\s+", "", _permit_scope_text(existing_permit))
    if raw_new_scope and raw_existing_scope:
        if raw_new_scope == raw_existing_scope and len(raw_new_scope) >= 4:
            return True
        if len(raw_new_scope) >= 8 and len(raw_existing_scope) >= 8:
            if raw_new_scope in raw_existing_scope or raw_existing_scope in raw_new_scope:
                return True

    new_scope = _normalize_scope(raw_new_scope)
    existing_scope = _normalize_scope(raw_existing_scope)
    if len(new_scope) < 6 or len(existing_scope) < 6:
        return False
    return new_scope in existing_scope or existing_scope in new_scope


def _extract_json_object(content: str) -> dict | None:
    text = str(content or "").strip()
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _scope_similarity_hint(left: str, right: str) -> float:
    left_scope = _normalize_scope(left)
    right_scope = _normalize_scope(right)
    if not left_scope or not right_scope:
        return 0.0
    return SequenceMatcher(None, left_scope, right_scope).ratio()


def _ai_best_same_work_scope(
    db: Session,
    *,
    requested_permit,
    candidates: list[WorkPermit],
) -> WorkPermit | None:
    requested_scope = _permit_scope_text(requested_permit)
    if not requested_scope or not candidates:
        return None

    scoped_candidates = [
        candidate
        for candidate in candidates
        if _permit_scope_text(candidate)
        and (
            _scope_similarity_hint(requested_scope, _permit_scope_text(candidate)) >= 0.18
            or _permit_type_enum(requested_permit) == candidate.type
        )
    ][:6]
    if not scoped_candidates:
        return None

    candidate_payload = [
        {
            "id": candidate.id,
            "type": candidate.type.value,
            "description": candidate.description or "",
            "end_time": candidate.end_time.isoformat() if candidate.end_time else None,
        }
        for candidate in scoped_candidates
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "你是施工安全作业许可匹配助手。只判断待办票描述和许可池描述是否属于同一个项目、"
                "同一个作业区域、同一个具体作业点/作业内容。不能仅因为票种相同、区域相同、文字相近就判定相同；"
                "如果作业对象、楼栋、位置、高度、施工内容明显不同，必须判定为不同。"
                "只输出 JSON，不要 markdown。格式："
                "{\"matches\":[{\"id\":1,\"same_work\":true,\"confidence\":90,\"reason\":\"...\"}]}"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "requested": {
                        "type": _permit_type_enum(requested_permit).value
                        if _permit_type_enum(requested_permit)
                        else None,
                        "description": requested_scope,
                    },
                    "candidates": candidate_payload,
                },
                ensure_ascii=False,
            ),
        },
    ]
    try:
        _provider, payload = ai_config_service.request_chat_completion(
            db,
            messages=messages,
            temperature=0,
            max_tokens=800,
            timeout=45,
        )
    except Exception:
        return None

    content = payload["choices"][0].get("message", {}).get("content", "")
    parsed = _extract_json_object(content)
    if not parsed or not isinstance(parsed.get("matches"), list):
        return None

    by_id = {candidate.id: candidate for candidate in scoped_candidates}
    valid_matches = []
    for item in parsed["matches"]:
        if not isinstance(item, dict) or not item.get("same_work"):
            continue
        try:
            candidate_id = int(item.get("id"))
            confidence = float(item.get("confidence") or 0)
        except (TypeError, ValueError):
            continue
        if confidence >= 80 and candidate_id in by_id:
            valid_matches.append((confidence, by_id[candidate_id]))

    if not valid_matches:
        return None
    valid_matches.sort(key=lambda item: (item[0], item[1].end_time or datetime.min), reverse=True)
    return valid_matches[0][1]


def _collapse_requested_permits(permits: list) -> list:
    collapsed: list = []
    for permit in permits:
        permit_type = _permit_type_enum(permit)
        if not permit_type:
            collapsed.append(permit)
            continue

        replaced = False
        for index, existing in enumerate(collapsed):
            existing_type = _permit_type_enum(existing)
            if existing_type and _permit_family(existing_type) == _permit_family(permit_type):
                if _permit_rank(permit_type) > _permit_rank(existing_type):
                    collapsed[index] = permit
                replaced = True
                break
        if not replaced:
            collapsed.append(permit)
    return collapsed


def _ensure_permit_descriptions(permits: list, *, title: str, area_name: str | None) -> list:
    enriched: list = []
    for permit in permits:
        permit_type = _permit_type_enum(permit)
        if isinstance(permit, dict):
            next_permit = dict(permit)
            if not str(next_permit.get("description") or "").strip():
                next_permit["description"] = "".join(
                    part for part in [area_name or "", title or "", _permit_label(permit_type)] if part
                )
            enriched.append(next_permit)
        else:
            if not _permit_field(permit, "description"):
                setattr(
                    permit,
                    "description",
                    "".join(part for part in [area_name or "", title or "", _permit_label(permit_type)] if part),
                )
            enriched.append(permit)
    return enriched


def _mark_existing_permit_match(permit, existing_permit: WorkPermit, now: datetime) -> None:
    match_info = {
        "matched": True,
        "existing_permit_id": existing_permit.id,
        "existing_type": existing_permit.type.value,
        "existing_description": existing_permit.description,
        "end_time": existing_permit.end_time.isoformat() if existing_permit.end_time else None,
        "remaining_percent": round(_remaining_percent(existing_permit, now), 1),
    }
    if isinstance(permit, dict):
        permit["covered_by_existing_permit"] = True
        permit["existing_permit_match"] = match_info
        return

    setattr(permit, "covered_by_existing_permit", True)
    setattr(permit, "existing_permit_match", match_info)


def _filter_permits_by_area_validity(
    db: Session,
    *,
    area_id: int | None,
    permits: list,
    allow_ai_scope_match: bool = True,
) -> tuple[list, list[dict]]:
    if not permits:
        return permits, []

    permits = _collapse_requested_permits(permits)
    if not area_id:
        return permits, []
    now = local_now()
    def append_reason(permit, extra: str) -> None:
        if isinstance(permit, dict):
            permit["reason"] = f"{permit.get('reason') or ''} {extra}".strip()
        elif hasattr(permit, "reason"):
            permit.reason = f"{permit.reason or ''} {extra}".strip()

    requested_types = [_permit_type_enum(permit) for permit in permits]
    permit_types = [permit_type for permit_type in requested_types if permit_type]
    if not permit_types:
        return permits, []

    query_types = set(permit_types)
    permit_families = {_permit_family(permit_type) for permit_type in permit_types}
    if "height" in permit_families:
        query_types.update(PERMIT_FAMILY_RANKS["height"].keys())
    if "hot_work" in permit_families:
        query_types.update(PERMIT_FAMILY_RANKS["hot_work"].keys())

    existing_permits = (
        db.query(WorkPermit)
        .filter(
            WorkPermit.area_id == area_id,
            WorkPermit.type.in_(query_types),
            WorkPermit.photo_url.isnot(None),
            WorkPermit.status.in_([PermitStatus.ACTIVE, PermitStatus.WARNING]),
        )
        .all()
    )

    valid_existing = [
        existing
        for existing in existing_permits
        if _remaining_percent(existing, now) > 0
    ]

    def best_matching_existing(permit, *, require_active: bool) -> WorkPermit | None:
        permit_type = _permit_type_enum(permit)
        if not permit_type:
            return None
        candidates = [
            existing
            for existing in valid_existing
            if _permit_covers(existing.type, permit_type)
            and (
                _remaining_percent(existing, now) > WARNING_THRESHOLD_PERCENT
                if require_active
                else _remaining_percent(existing, now) <= WARNING_THRESHOLD_PERCENT
            )
        ]
        matches = [
            existing
            for existing in candidates
            if _is_same_work_scope(permit, existing)
        ]
        if not matches and allow_ai_scope_match:
            return _ai_best_same_work_scope(db, requested_permit=permit, candidates=candidates)
        if not matches:
            return None
        return max(matches, key=lambda item: item.end_time or datetime.min)

    filtered = []
    suppressed: list[dict] = []
    for permit in permits:
        active_permit = best_matching_existing(permit, require_active=True)
        if active_permit:
            permit_type = _permit_type_enum(permit)
            _mark_existing_permit_match(permit, active_permit, now)
            suppressed.append(
                {
                    "type": permit_type.value if permit_type else None,
                    "existing_permit_id": active_permit.id,
                    "existing_type": active_permit.type.value,
                    "existing_description": active_permit.description,
                    "end_time": active_permit.end_time.isoformat() if active_permit.end_time else None,
                    "remaining_percent": round(_remaining_percent(active_permit, now), 1),
                }
            )
            filtered.append(permit)
            continue

        warning_permit = best_matching_existing(permit, require_active=False)
        if warning_permit:
            append_reason(
                permit,
                f"同一作业点已有该类票证但剩余有效期不超过{WARNING_THRESHOLD_PERCENT}%，需要继续提醒续票或重新办票。",
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
    permits = _ensure_permit_descriptions(
        [dict(permit) for permit in payload.get("permits", [])],
        title=payload["summary"],
        area_name=history.area.name if history.area else None,
    )
    filtered_permits, suppressed_permits = _filter_permits_by_area_validity(
        db,
        area_id=history.area_id,
        permits=permits,
        allow_ai_scope_match=False,
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
    cutoff = local_now() - timedelta(days=AI_HISTORY_RETENTION_DAYS)
    db.query(AIAnalysisHistory).filter(AIAnalysisHistory.created_at < cutoff).delete(synchronize_session=False)
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
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cutoff = local_now() - timedelta(days=AI_HISTORY_RETENTION_DAYS)
    db.query(AIAnalysisHistory).filter(AIAnalysisHistory.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
    query = db.query(AIAnalysisHistory)
    query = query.filter(AIAnalysisHistory.created_at >= cutoff)
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
    return [_history_out(db, history) for history in histories]


@router.delete("/history/{history_id}")
def delete_ai_analysis_history(
    history_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = db.query(AIAnalysisHistory).filter(AIAnalysisHistory.id == history_id).first()
    if not history:
        raise HTTPException(status_code=404, detail="Analysis history not found")

    ensure_area_access(db, current_user, history.area_id)
    db.delete(history)
    db.commit()
    return {"message": "Analysis history deleted"}


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
            area = db.query(Area).filter(Area.id == data.area_id).first()
            _save_analysis_history(
                db,
                session_id=session_id,
                area_id=data.area_id,
                creator_id=current_user.id,
                payload=parsed,
            )
            permits = _ensure_permit_descriptions(
                parsed.get("permits", []),
                title=str(parsed.get("summary") or "").strip(),
                area_name=area.name if area else None,
            )
            filtered_permits, suppressed_permits = _filter_permits_by_area_validity(
                db,
                area_id=data.area_id,
                permits=permits,
                allow_ai_scope_match=False,
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
        filtered_permits, suppressed_permits = _filter_permits_by_area_validity(
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
            "suppressed_permit_count": len(suppressed_permits),
            "suppressed_permits": suppressed_permits,
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
