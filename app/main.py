import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, or_, text

from app.api.ai_risk import router as ai_router
from app.api.areas import router as areas_router
from app.api.auth import router as auth_router
from app.api.files import router as files_router
from app.api.fines import router as fines_router
from app.api.permits import router as permits_router
from app.api.quality import router as quality_router
from app.api.safety_logs import router as safety_logs_router
from app.api.tasks import router as tasks_router
from app.api.users import router as users_router
from app.config import settings, validate_security_settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
from app.models.user import User, UserRole, UserStatus


def init_admin():
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
        if admin:
            return

        configured_user = (
            db.query(User)
            .filter(User.username == settings.ADMIN_USERNAME)
            .first()
        )
        if configured_user:
            configured_user.role = UserRole.ADMIN
            configured_user.status = UserStatus.APPROVED
            db.commit()
            return

        if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD:
            raise RuntimeError("Initial administrator credentials are not configured")

        admin = User(
            username=settings.ADMIN_USERNAME,
            password_hash=hash_password(settings.ADMIN_PASSWORD),
            real_name=settings.ADMIN_REAL_NAME,
            role=UserRole.ADMIN,
            status=UserStatus.APPROVED,
        )
        db.add(admin)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Init] Admin init error: {e}")
    finally:
        db.close()


def ensure_runtime_schema():
    """Add lightweight SQLite columns for existing installations."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    rebuild_areas_table_if_unique()

    inspector = inspect(engine)
    with engine.begin() as conn:
        table_names = set(inspector.get_table_names())
        area_columns = {column["name"] for column in inspector.get_columns("areas")}
        if "parent_id" not in area_columns:
            conn.execute(text("ALTER TABLE areas ADD COLUMN parent_id INTEGER"))
        if "is_active" not in area_columns:
            conn.execute(text("ALTER TABLE areas ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_areas_is_active ON areas (is_active)"))

        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "managed_area_id" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN managed_area_id INTEGER"))

        if "tasks" in table_names:
            task_columns = {column["name"] for column in inspector.get_columns("tasks")}
            if "required_permits" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN required_permits TEXT"))
            if "project_name" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN project_name VARCHAR(200)"))
            if "work_point" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN work_point VARCHAR(200)"))
            if "process_name" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN process_name VARCHAR(200)"))

        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_analysis_histories (
                    id INTEGER NOT NULL PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    area_id INTEGER,
                    creator_id INTEGER NOT NULL,
                    ai_session_id VARCHAR(64) NOT NULL,
                    module VARCHAR(32) NOT NULL DEFAULT 'risk',
                    payload TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    FOREIGN KEY(area_id) REFERENCES areas (id),
                    FOREIGN KEY(creator_id) REFERENCES users (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_analysis_histories_id ON ai_analysis_histories (id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_analysis_histories_area_id ON ai_analysis_histories (area_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_analysis_histories_creator_id ON ai_analysis_histories (creator_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_analysis_histories_ai_session_id ON ai_analysis_histories (ai_session_id)"))
        history_columns = {column["name"] for column in inspector.get_columns("ai_analysis_histories")}
        if "module" not in history_columns:
            conn.execute(text("ALTER TABLE ai_analysis_histories ADD COLUMN module VARCHAR(32) NOT NULL DEFAULT 'risk'"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_analysis_histories_module ON ai_analysis_histories (module)"))

        if "fine_tickets" in table_names:
            fine_columns = {column["name"] for column in inspector.get_columns("fine_tickets")}
            if "area_id" not in fine_columns:
                conn.execute(text("ALTER TABLE fine_tickets ADD COLUMN area_id INTEGER"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_fine_tickets_area_id ON fine_tickets (area_id)"))

        if "checklist_items" in table_names:
            checklist_columns = {column["name"] for column in inspector.get_columns("checklist_items")}
            if "inspection_points" not in checklist_columns:
                conn.execute(text("ALTER TABLE checklist_items ADD COLUMN inspection_points TEXT"))
            if "photo_requirements" not in checklist_columns:
                conn.execute(text("ALTER TABLE checklist_items ADD COLUMN photo_requirements TEXT"))

        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS work_permit_renewals (
                    id INTEGER NOT NULL PRIMARY KEY,
                    permit_id INTEGER NOT NULL,
                    operator_id INTEGER NOT NULL,
                    old_start_time DATETIME,
                    old_end_time DATETIME,
                    new_start_time DATETIME NOT NULL,
                    new_end_time DATETIME NOT NULL,
                    old_photo_url VARCHAR(500),
                    new_photo_url VARCHAR(500),
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY(permit_id) REFERENCES work_permits (id) ON DELETE CASCADE,
                    FOREIGN KEY(operator_id) REFERENCES users (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_work_permit_renewals_id ON work_permit_renewals (id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_work_permit_renewals_permit_id ON work_permit_renewals (permit_id)"))

        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS safety_log_exports (
                    id INTEGER NOT NULL PRIMARY KEY,
                    subject_user_id INTEGER NOT NULL,
                    exported_by_id INTEGER NOT NULL,
                    log_date DATE NOT NULL,
                    file_path VARCHAR(500) NOT NULL,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY(subject_user_id) REFERENCES users (id),
                    FOREIGN KEY(exported_by_id) REFERENCES users (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_safety_log_exports_id ON safety_log_exports (id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_safety_log_exports_subject_user_id ON safety_log_exports (subject_user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_safety_log_exports_exported_by_id ON safety_log_exports (exported_by_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_safety_log_exports_log_date ON safety_log_exports (log_date)"))


def rebuild_areas_table_if_unique():
    raw_conn = engine.raw_connection()
    try:
        cursor = raw_conn.cursor()
        indexes = cursor.execute("PRAGMA index_list(areas)").fetchall()
        has_name_unique = any(
            index_row[2] == 1
            and cursor.execute(f"PRAGMA index_info({index_row[1]})").fetchall() == [(0, 1, "name")]
            for index_row in indexes
        )
        if not has_name_unique:
            return

        area_columns = {row[1] for row in cursor.execute("PRAGMA table_info(areas)").fetchall()}
        parent_select = "parent_id" if "parent_id" in area_columns else "NULL"
        active_select = "is_active" if "is_active" in area_columns else "1"
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.executescript(
            f"""
            CREATE TABLE areas_new (
                id INTEGER NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                parent_id INTEGER,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME
            );
            INSERT INTO areas_new (id, name, parent_id, description, is_active, created_at)
            SELECT id, name, {parent_select}, description, {active_select}, created_at FROM areas;
            DROP TABLE areas;
            ALTER TABLE areas_new RENAME TO areas;
            CREATE INDEX ix_areas_id ON areas (id);
            CREATE INDEX ix_areas_parent_id ON areas (parent_id);
            CREATE INDEX ix_areas_is_active ON areas (is_active);
            """
        )
        cursor.execute("PRAGMA foreign_keys=ON")
        raw_conn.commit()
    finally:
        raw_conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_security_settings()
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    init_admin()
    start_scheduler()
    print("[SafeInspect] Server started")
    yield
    stop_scheduler()
    print("[SafeInspect] Server stopped")


app = FastAPI(lifespan=lifespan, title="SafeInspect API")

cors_origins = [
    origin.strip()
    for origin in str(settings.CORS_ORIGINS or "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; "
        "object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:",
    )

    if request.url.path.startswith(("/api/auth", "/api/files")):
        response.headers.setdefault("Cache-Control", "no-store, max-age=0")
        response.headers.setdefault("Pragma", "no-cache")

    return response

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router)
app.include_router(areas_router)
app.include_router(tasks_router)
app.include_router(permits_router)
app.include_router(safety_logs_router)
app.include_router(ai_router)
app.include_router(quality_router)
app.include_router(files_router)
app.include_router(fines_router)

UPLOAD_DIR = settings.UPLOAD_DIR
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

STATIC_DIR = Path(__file__).resolve().parent / "static"
ASSETS_DIR = STATIC_DIR / "assets"

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="frontend-assets")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


def _frontend_response(requested_path: str = ""):
    if not STATIC_DIR.exists():
        return JSONResponse(status_code=404, content={"detail": "Frontend not built"})

    static_root = STATIC_DIR.resolve()
    clean_path = requested_path.strip("/")

    if clean_path:
        candidate = (STATIC_DIR / clean_path).resolve()
        try:
            candidate.relative_to(static_root)
        except ValueError:
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

        if candidate.is_file():
            return FileResponse(candidate)

    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    return JSONResponse(status_code=404, content={"detail": "Frontend not built"})


@app.get("/", include_in_schema=False)
async def frontend_index():
    return _frontend_response()


@app.get("/{full_path:path}", include_in_schema=False)
async def frontend_fallback(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return _frontend_response(full_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
