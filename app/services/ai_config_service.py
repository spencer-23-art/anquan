import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.system_config import SystemConfig


def _get_config_item(db: Session, key: str) -> SystemConfig | None:
    return db.query(SystemConfig).filter(SystemConfig.key == key).first()


def _get_config_value(db: Session, key: str, default: str = "") -> str:
    item = _get_config_item(db, key)
    return item.value if item and item.value is not None else default


def _set_config_value(db: Session, key: str, value: str, description: str) -> None:
    item = _get_config_item(db, key)
    if item:
        item.value = value
        item.description = description
    else:
        db.add(SystemConfig(key=key, value=value, description=description))


def normalize_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if normalized and not normalized.endswith("/v1"):
        normalized += "/v1"
    return normalized


def _mask_api_key(api_key: str) -> str | None:
    if not api_key:
        return None
    if len(api_key) <= 12:
        return "****"
    return f"{api_key[:8]}****{api_key[-4:]}"


def _build_legacy_provider(db: Session) -> tuple[list[dict[str, Any]], str | None]:
    base_url = _get_config_value(db, SystemConfig.AI_BASE_URL)
    api_key = _get_config_value(db, SystemConfig.AI_API_KEY)
    model = _get_config_value(db, SystemConfig.AI_MODEL) or "deepseek-ai/DeepSeek-V3"

    if not any([base_url, api_key, model]):
        return [], None

    provider_id = "default"
    provider = {
        "id": provider_id,
        "name": "默认接口",
        "base_url": base_url.strip(),
        "api_key": api_key.strip(),
        "model": model.strip(),
        "enabled": True,
    }
    return [provider], provider_id


def load_provider_configs(db: Session) -> tuple[list[dict[str, Any]], str | None]:
    raw_configs = _get_config_value(db, SystemConfig.AI_PROVIDER_CONFIGS)
    active_provider_id = _get_config_value(db, SystemConfig.AI_ACTIVE_PROVIDER) or None

    if raw_configs:
        try:
            providers = json.loads(raw_configs)
        except json.JSONDecodeError:
            providers = []
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(providers):
            if not isinstance(item, dict):
                continue
            provider_id = str(item.get("id") or f"provider-{index + 1}")
            normalized.append(
                {
                    "id": provider_id,
                    "name": str(item.get("name") or f"接口 {index + 1}").strip(),
                    "base_url": str(item.get("base_url") or "").strip(),
                    "api_key": str(item.get("api_key") or "").strip(),
                    "model": str(item.get("model") or "deepseek-ai/DeepSeek-V3").strip(),
                    "enabled": bool(item.get("enabled", True)),
                }
            )
        if not active_provider_id and normalized:
            active_provider_id = normalized[0]["id"]
        return normalized, active_provider_id

    return _build_legacy_provider(db)


def list_provider_summaries(db: Session, include_secrets: bool = False) -> tuple[list[dict[str, Any]], str | None]:
    providers, active_provider_id = load_provider_configs(db)
    summaries: list[dict[str, Any]] = []
    for provider in providers:
        item = {
            "id": provider["id"],
            "name": provider["name"],
            "base_url": provider["base_url"],
            "model": provider["model"],
            "enabled": provider["enabled"],
            "is_active": provider["id"] == active_provider_id,
            "api_key_masked": _mask_api_key(provider.get("api_key", "")),
        }
        if include_secrets:
            item["api_key"] = provider.get("api_key", "")
        summaries.append(item)
    return summaries, active_provider_id


def save_provider_configs(
    db: Session,
    providers: list[dict[str, Any]],
    active_provider_id: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    existing_providers, existing_active = load_provider_configs(db)
    existing_map = {provider["id"]: provider for provider in existing_providers}

    cleaned: list[dict[str, Any]] = []
    for index, provider in enumerate(providers):
        provider_id = str(provider.get("id") or uuid.uuid4().hex[:8])
        old_provider = existing_map.get(provider_id, {})

        api_key = str(provider.get("api_key") or "").strip()
        if not api_key:
            api_key = str(old_provider.get("api_key") or "").strip()

        cleaned_item = {
            "id": provider_id,
            "name": str(provider.get("name") or f"接口 {index + 1}").strip(),
            "base_url": str(provider.get("base_url") or "").strip(),
            "api_key": api_key,
            "model": str(provider.get("model") or "deepseek-ai/DeepSeek-V3").strip(),
            "enabled": bool(provider.get("enabled", True)),
        }

        if not cleaned_item["base_url"] and not cleaned_item["api_key"] and not cleaned_item["model"]:
            continue
        cleaned.append(cleaned_item)

    if not cleaned:
        active_provider_id = None
    elif not active_provider_id or active_provider_id not in {item["id"] for item in cleaned}:
        active_provider_id = existing_active if existing_active in {item["id"] for item in cleaned} else cleaned[0]["id"]

    _set_config_value(
        db,
        SystemConfig.AI_PROVIDER_CONFIGS,
        json.dumps(cleaned, ensure_ascii=False),
        "AI provider configs",
    )
    _set_config_value(
        db,
        SystemConfig.AI_ACTIVE_PROVIDER,
        active_provider_id or "",
        "AI active provider id",
    )

    active_provider = None
    if active_provider_id:
        active_provider = next((item for item in cleaned if item["id"] == active_provider_id), None)

    _set_config_value(
        db,
        SystemConfig.AI_BASE_URL,
        active_provider.get("base_url", "") if active_provider else "",
        "Active AI base URL",
    )
    _set_config_value(
        db,
        SystemConfig.AI_API_KEY,
        active_provider.get("api_key", "") if active_provider else "",
        "Active AI API key",
    )
    _set_config_value(
        db,
        SystemConfig.AI_MODEL,
        active_provider.get("model", "") if active_provider else "",
        "Active AI model",
    )

    db.commit()
    return cleaned, active_provider_id


def get_runtime_provider(db: Session, provider_id: str | None = None) -> dict[str, Any] | None:
    providers, active_provider_id = load_provider_configs(db)
    enabled_providers = [item for item in providers if item.get("enabled", True)]
    if not enabled_providers:
        return None

    if provider_id:
        selected = next((item for item in enabled_providers if item["id"] == provider_id), None)
        if selected:
            return selected

    if active_provider_id:
        selected = next((item for item in enabled_providers if item["id"] == active_provider_id), None)
        if selected:
            return selected

    return enabled_providers[0]
