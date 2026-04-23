from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import SessionLocal
from app.models.work_permit import WARNING_THRESHOLD_PERCENT, PermitStatus, WorkPermit

scheduler = BackgroundScheduler()


def scan_permits() -> None:
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        active_permits = db.query(WorkPermit).filter(
            WorkPermit.status.in_([PermitStatus.ACTIVE, PermitStatus.WARNING])
        ).all()

        for permit in active_permits:
            if not permit.start_time or not permit.end_time:
                continue

            total_duration = (permit.end_time - permit.start_time).total_seconds()
            remaining = (permit.end_time - now).total_seconds()

            if remaining <= 0:
                permit.status = PermitStatus.EXPIRED
                continue

            remaining_percent = (remaining / total_duration * 100) if total_duration > 0 else 0
            if remaining_percent < WARNING_THRESHOLD_PERCENT:
                permit.status = PermitStatus.WARNING
            else:
                permit.status = PermitStatus.ACTIVE

        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[Scheduler] Permit scan failed: {exc}")
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        scan_permits,
        "interval",
        minutes=1,
        id="permit_scanner",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
