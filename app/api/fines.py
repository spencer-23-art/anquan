from datetime import datetime
from decimal import Decimal
from pathlib import Path

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.area import Area
from app.models.fine_ticket import FineTicket, FineTicketType
from app.models.task import Task
from app.models.user import User, UserRole
from app.models.work_permit import WorkPermit
from app.schemas.fine_ticket import (
    FineDescriptionRequest,
    FineDescriptionResponse,
    FineNumberPreview,
    FineRuleOption,
    FineRuleOptionsResponse,
    FineTicketCreateResponse,
    FineTicketHistoryItem,
)
from app.services import fine_ticket_service
from app.services.area_scope import ensure_area_access, is_super_admin, managed_area_ids
from app.services.fine_rule_catalog import find_rule_matches, get_rule, recommend_rule_id

router = APIRouter(prefix="/api/fines", tags=["fines"])


def ensure_fine_access(db: Session, current_user: User, record: FineTicket) -> None:
    if is_super_admin(current_user):
        return
    if current_user.role != UserRole.ADMIN:
        if record.creator_id != current_user.id:
            raise HTTPException(status_code=403, detail="No permission to access this fine ticket")
        return

    allowed_ids = managed_area_ids(db, current_user) or []
    if not record.area_id or record.area_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="No permission to access this fine ticket")


def ensure_fine_area_access(db: Session, current_user: User, area_id: int) -> None:
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    if not area.is_active:
        raise HTTPException(status_code=409, detail="Archived areas cannot receive new fine tickets")
    if current_user.role in (UserRole.ADMIN, UserRole.EXTERNAL):
        ensure_area_access(db, current_user, area_id)
        return

    has_assigned_task = db.query(Task.id).filter(
        Task.assignee_id == current_user.id,
        Task.area_id == area_id,
    ).first()
    has_own_permit = db.query(WorkPermit.id).filter(
        WorkPermit.applicant_id == current_user.id,
        WorkPermit.area_id == area_id,
    ).first()
    if not has_assigned_task and not has_own_permit:
        raise HTTPException(status_code=403, detail="No permission to create a fine ticket for this area")


@router.get("/next-number", response_model=FineNumberPreview)
def next_number(
    type: str = "quality",
    _user: User = Depends(get_current_user),
):
    try:
        ticket_type = FineTicketType(type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid fine ticket type") from exc
    return FineNumberPreview(number=fine_ticket_service.peek_next_number(ticket_type))


@router.post("/generate-description", response_model=FineDescriptionResponse)
def generate_description(
    data: FineDescriptionRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        ticket_type = FineTicketType(data.penalty_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid fine ticket type") from exc

    if not data.rule_id:
        raise HTTPException(status_code=422, detail="Please confirm a specific legal basis before generating the description")
    try:
        rule = get_rule(data.rule_id, ticket_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    description = fine_ticket_service.generate_description(
        db=db,
        user_input=data.input,
        project_name=data.project_name,
        team_name=data.team_name,
        location=data.location,
        discovery_date=data.discovery_date,
        ticket_type=ticket_type,
        rule=rule,
    )
    return FineDescriptionResponse(
        description=description,
        rule_id=rule.id,
        rule_reference=rule.reference,
        legal_basis=rule.legal_basis,
        technical_basis=rule.technical_basis,
    )


@router.get("/rule-options", response_model=FineRuleOptionsResponse)
def fine_rule_options(
    type: str = "quality",
    input: str = "",
    project_name: str = "",
    team_name: str = "",
    location: str = "",
    _user: User = Depends(get_current_user),
):
    try:
        ticket_type = FineTicketType(type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid fine ticket type") from exc

    context = " ".join([input, project_name, team_name, location])
    recommended_id = recommend_rule_id(ticket_type, context)
    options = [
        FineRuleOption(
            id=rule.id,
            label=rule.label,
            legal_basis=rule.legal_basis,
            technical_basis=rule.technical_basis,
            rule_reference=rule.reference,
            source_url=rule.source_url,
            matched_keywords=list(matched_keywords),
            is_recommended=rule.id == recommended_id,
        )
        for rule, matched_keywords in find_rule_matches(ticket_type, context)
    ]
    return FineRuleOptionsResponse(options=options, recommended_rule_id=recommended_id)


@router.post("", response_model=FineTicketCreateResponse)
def create_fine_ticket(
    penalty_type: str = Form(...),
    area_id: int = Form(...),
    project_name: str = Form(...),
    team_name: str = Form(...),
    location: str = Form(...),
    discovery_date: str = Form(""),
    amount: str = Form(...),
    description: str = Form(...),
    rule_id: str = Form(...),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        ticket_type = FineTicketType(penalty_type)
        amount_value = Decimal(amount)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid fine ticket payload") from exc
    if not amount_value.is_finite() or amount_value <= 0:
        raise HTTPException(status_code=400, detail="Fine amount must be greater than zero")

    photo_paths: list[Path] = []
    try:
        ensure_fine_area_access(db, current_user, area_id)
        try:
            rule = get_rule(rule_id, ticket_type)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        final_description = fine_ticket_service.apply_rule_to_description(
            description,
            discovery_date,
            ticket_type,
            rule,
        )

        number = fine_ticket_service.consume_next_number(ticket_type)
        photo_paths = fine_ticket_service.save_uploaded_photos(photos)
        filename, output_path = fine_ticket_service.build_fine_document(
            number=number,
            ticket_type=ticket_type,
            project_name=project_name,
            team_name=team_name,
            location=location,
            discovery_date=discovery_date,
            amount=amount_value,
            description=final_description,
            photo_paths=photo_paths,
            rule_reference=rule.reference,
        )

        record = FineTicket(
            number=number,
            ticket_type=ticket_type,
            area_id=area_id,
            project_name=project_name,
            team_name=team_name,
            location=location,
            discovery_date=discovery_date,
            amount=amount_value,
            description=final_description,
            rule_id=rule.id,
            rule_reference=rule.reference,
            document_path=str(output_path),
            photo_count=len(photo_paths),
            creator_id=current_user.id,
            created_at=datetime.now(),
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        return FineTicketCreateResponse(
            id=record.id,
            number=record.number,
            filename=filename,
            download_url=f"/fines/{record.id}/download",
            area_id=record.area_id,
        )
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create fine ticket: {exc}") from exc


@router.get("/history", response_model=list[FineTicketHistoryItem])
def fine_ticket_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(FineTicket)
    if is_super_admin(current_user):
        pass
    elif current_user.role == UserRole.ADMIN:
        allowed_ids = managed_area_ids(db, current_user) or []
        query = query.filter(FineTicket.area_id.in_(allowed_ids))
    else:
        query = query.filter(FineTicket.creator_id == current_user.id)
    records = query.order_by(FineTicket.created_at.desc()).all()
    items: list[FineTicketHistoryItem] = []
    for record in records:
        creator_name = getattr(record.creator, "real_name", None) or getattr(record.creator, "username", None)
        items.append(
            FineTicketHistoryItem(
                id=record.id,
                number=record.number,
                ticket_type=record.ticket_type.value,
                area_id=record.area_id,
                area_name=getattr(record.area, "name", None),
                project_name=record.project_name,
                team_name=record.team_name,
                location=record.location,
                discovery_date=record.discovery_date,
                amount=record.amount,
                description=record.description,
                rule_id=record.rule_id,
                rule_reference=record.rule_reference,
                photo_count=record.photo_count,
                created_at=record.created_at,
                creator_name=creator_name,
                download_url=f"/fines/{record.id}/download",
            )
        )
    return items


@router.get("/{fine_id}/download")
def download_fine_ticket(
    fine_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.query(FineTicket).filter(FineTicket.id == fine_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Fine ticket not found")
    ensure_fine_access(db, current_user, record)

    path = Path(record.document_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Fine ticket document missing")

    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{record.number}.docx",
    )
