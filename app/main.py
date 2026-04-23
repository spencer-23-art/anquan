import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from sqlalchemy import or_

from app.config import settings
from app.database import engine, Base, SessionLocal
from app.models.user import User
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.areas import router as areas_router
from app.api.tasks import router as tasks_router
from app.api.permits import router as permits_router
from app.api.ai_risk import router as ai_router
from app.api.files import router as files_router
from app.api.fines import router as fines_router
from app.core.security import hash_password
from app.models.user import UserRole, UserStatus
from app.core.scheduler import start_scheduler, stop_scheduler

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
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

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers - 业务路由各自已经声明了 prefix，这里不要重复追加
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router)
app.include_router(areas_router)
app.include_router(tasks_router)
app.include_router(permits_router)
app.include_router(ai_router)
app.include_router(files_router)
app.include_router(fines_router)

# Upload storage
UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@app.get("/api/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
