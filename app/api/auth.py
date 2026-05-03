from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import unicodedata

from app.api.deps import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserRole, UserStatus
from app.schemas.user import Token, UserLogin, UserOut, UserRegister

router = APIRouter(tags=["auth"])

MAX_LOGIN_FAILURES = 5
LOGIN_LOCK_MINUTES = 10
_login_failures: dict[str, list[datetime]] = {}


def normalize_username(username: str) -> str:
    text = unicodedata.normalize("NFKC", str(username or ""))
    return "".join(
        char for char in text if not char.isspace() and unicodedata.category(char) != "Cf"
    ).lower()


def _login_key(username: str) -> str:
    return normalize_username(username)


def _find_user_by_username(db: Session, username: str) -> User | None:
    stripped = str(username or "").strip()
    user = db.query(User).filter(User.username == stripped).first()
    if user:
        return user
    normalized = normalize_username(username)
    for candidate in db.query(User).all():
        if normalize_username(candidate.username) == normalized:
            return candidate
    return None


def _assert_login_not_locked(username: str) -> None:
    key = _login_key(username)
    cutoff = datetime.utcnow() - timedelta(minutes=LOGIN_LOCK_MINUTES)
    recent_failures = [item for item in _login_failures.get(key, []) if item > cutoff]
    _login_failures[key] = recent_failures
    if len(recent_failures) >= MAX_LOGIN_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Login locked temporarily after too many failed attempts",
        )


def _record_login_failure(username: str) -> None:
    key = _login_key(username)
    _login_failures.setdefault(key, []).append(datetime.utcnow())


def _clear_login_failures(username: str) -> None:
    _login_failures.pop(_login_key(username), None)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(data: UserRegister, db: Session = Depends(get_db)):
    username = unicodedata.normalize("NFKC", data.username).strip()
    existing = _find_user_by_username(db, username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=username,
        password_hash=hash_password(data.password),
        real_name=data.real_name,
        phone=data.phone,
        role=UserRole.INSPECTOR,
        status=UserStatus.PENDING,
        created_at=datetime.utcnow()
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    _assert_login_not_locked(data.username)
    user = _find_user_by_username(db, data.username)
    if not user or not verify_password(data.password, user.password_hash):
        _record_login_failure(data.username)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if user.status != UserStatus.APPROVED:
        raise HTTPException(
            status_code=403,
            detail=f"Account is not approved: {user.status.value}",
        )

    _clear_login_failures(data.username)
    token = create_access_token(data={"sub": str(user.id)})
    return Token(access_token=token, user=UserOut.model_validate(user))
