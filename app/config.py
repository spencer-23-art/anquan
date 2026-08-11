from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./safeinspect.db"

    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720
    CORS_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"
    ADMIN_USERNAME: str = ""
    ADMIN_PASSWORD: str = ""
    ADMIN_REAL_NAME: str = "Administrator"

    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


def validate_security_settings() -> None:
    """Fail closed when a deployment misses required authentication settings."""
    insecure_secrets = {
        "safeinspect-dev-secret-key-change-in-production",
        "your-super-secret-key-change-this",
    }
    if not settings.SECRET_KEY or settings.SECRET_KEY in insecure_secrets:
        raise RuntimeError("SECRET_KEY must be set to a unique, strong value")
    if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD:
        raise RuntimeError("ADMIN_USERNAME and ADMIN_PASSWORD must be configured")
    if not 1 <= settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 7 * 24 * 60:
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 minute and 7 days")
