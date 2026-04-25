import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
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
from app.api.tasks import router as tasks_router
from app.api.users import router as users_router
from app.config import settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
from app.models.user import User, UserRole, UserStatus


def init_admin():
    db = SessionLocal()
    try:
        admin = (
            db.query(User)
            .filter(
                or_(
                    User.username == settings.ADMIN_USERNAME,
                    User.role == UserRole.ADMIN,
                )
            )
            .first()
        )
        if not admin:
            admin = User(
                username=settings.ADMIN_USERNAME,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                real_name=settings.ADMIN_REAL_NAME,
                role=UserRole.ADMIN,
                status=UserStatus.APPROVED,
            )
            db.add(admin)
        else:
            admin.username = settings.ADMIN_USERNAME
            admin.password_hash = hash_password(settings.ADMIN_PASSWORD)
            admin.real_name = settings.ADMIN_REAL_NAME
            admin.role = UserRole.ADMIN
            admin.status = UserStatus.APPROVED
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
        area_columns = {column["name"] for column in inspector.get_columns("areas")}
        if "parent_id" not in area_columns:
            conn.execute(text("ALTER TABLE areas ADD COLUMN parent_id INTEGER"))

        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "managed_area_id" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN managed_area_id INTEGER"))

        table_names = set(inspector.get_table_names())
        if "fine_tickets" in table_names:
            fine_columns = {column["name"] for column in inspector.get_columns("fine_tickets")}
            if "area_id" not in fine_columns:
                conn.execute(text("ALTER TABLE fine_tickets ADD COLUMN area_id INTEGER"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_fine_tickets_area_id ON fine_tickets (area_id)"))

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
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.executescript(
            f"""
            CREATE TABLE areas_new (
                id INTEGER NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                parent_id INTEGER,
                description TEXT,
                created_at DATETIME
            );
            INSERT INTO areas_new (id, name, parent_id, description, created_at)
            SELECT id, name, {parent_select}, description, created_at FROM areas;
            DROP TABLE areas;
            ALTER TABLE areas_new RENAME TO areas;
            CREATE INDEX ix_areas_id ON areas (id);
            CREATE INDEX ix_areas_parent_id ON areas (parent_id);
            """
        )
        cursor.execute("PRAGMA foreign_keys=ON")
        raw_conn.commit()
    finally:
        raw_conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router)
app.include_router(areas_router)
app.include_router(tasks_router)
app.include_router(permits_router)
app.include_router(ai_router)
app.include_router(files_router)
app.include_router(fines_router)

UPLOAD_DIR = "uploads"
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
