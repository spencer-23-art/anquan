from sqlalchemy.orm import Session

from app.models.area import Area


def clean_task_context_text(value: str | None, limit: int = 200) -> str | None:
    text = str(value or "").strip()
    return text[:limit] if text else None


def resolve_project_name(
    db: Session,
    area_id: int,
    explicit_project_name: str | None = None,
) -> str | None:
    explicit = clean_task_context_text(explicit_project_name)
    if explicit:
        return explicit

    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        return None
    project_area = area.parent or area
    return clean_task_context_text(project_area.name)


def build_task_description(prefix: str, session_id: str, work_point: str | None, process_name: str | None) -> str:
    details = [clean_task_context_text(work_point), clean_task_context_text(process_name)]
    detail_text = "；".join(item for item in details if item)
    if detail_text:
        return f"{prefix} {session_id}（{detail_text}）"
    return f"{prefix} {session_id}"
