from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./safeinspect.db"

    SECRET_KEY: str = "safeinspect-dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200
    CORS_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"
    ADMIN_USERNAME: str = "spencer"
    ADMIN_PASSWORD: str = "s2484815"
    ADMIN_REAL_NAME: str = "Spencer"

    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE: int = 200 * 1024

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
