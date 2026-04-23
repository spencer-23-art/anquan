import json
import re
import uuid
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.services import ai_config_service

_sessions: dict[str, list[dict]] = {}

SYSTEM_PROMPT = """
你是一位建筑施工安全专家。你必须只返回 JSON，不要输出任何额外解释。

当信息不足时，只返回：
{"type":"question","content":"需要补充的问题"}

当信息足够时，只返回：
{
  "type":"checklist",
  "summary":"一句话任务标题",
  "permits":[{"type":"height_level2","reason":"为什么必须办理"}],
  "items":[
    {"risk_description":"风险点","measure":"控制措施","severity":"high"}
  ]
}

约束：
1. permits.type 只能是以下值之一：
   confined_space
   height_level1
   height_level2
   height_level3
   height_special
   hot_work_level1
   hot_work_level2
   hot_work_level3
   lifting
   excavation
   electrical
   other
2. items 至少输出 8 条，尽量覆盖人、机、料、法、环。
3. severity 只能是 low / medium / high。
4. 所有内容必须是简体中文。
"""

PERMIT_LABELS = {
    "confined_space": "受限空间作业票",
    "height_level1": "一级高处作业票",
    "height_level2": "二级高处作业票",
    "height_level3": "三级高处作业票",
    "height_special": "特级高处作业票",
    "hot_work_level1": "一级动火作业票",
    "hot_work_level2": "二级动火作业票",
    "hot_work_level3": "三级动火作业票",
    "lifting": "吊装作业票",
    "excavation": "动土作业票",
    "electrical": "临时用电作业票",
    "other": "其他作业票",
}

HEIGHT_KEYWORDS = ("高处", "高空", "脚手架", "登高车", "吊篮", "临边")
PIT_KEYWORDS = ("基坑", "地坑", "地沟", "井下", "沟槽", "坑内")
HOT_WORK_KEYWORDS = ("动火", "焊接", "切割", "明火", "气割")
LIFTING_KEYWORDS = ("吊装", "起重", "吊车", "汽车吊", "塔吊")
ELECTRICAL_KEYWORDS = ("临时用电", "临电", "配电箱", "电缆", "接电")
EXCAVATION_KEYWORDS = ("动土", "开挖", "土方", "挖沟", "挖槽")
ENVIRONMENT_KEYWORDS = ("高压线", "地下管线", "管线", "积水", "淤泥", "易燃", "障碍物")


def _normalize_ai_content(content: str) -> str:
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _extract_upstream_error_text(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text.strip() or "empty response body"

    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("msg") or json.dumps(error, ensure_ascii=False))
        if error:
            return str(error)
        if data.get("message"):
            return str(data["message"])
    return json.dumps(data, ensure_ascii=False)


def _joined_user_text(messages: list[dict]) -> str:
    return "\n".join(item["content"] for item in messages if item["role"] == "user")


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _extract_first_number(text: str, patterns: list[str]) -> Optional[float]:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return float(match.group(1))
    return None


def _extract_worker_count(text: str) -> Optional[int]:
    match = re.search(r"(\d+)\s*人", text)
    if match:
        return int(match.group(1))
    return None


def _extract_scene_facts(messages: list[dict]) -> dict:
    text = _joined_user_text(messages)
    return {
        "text": text,
        "workers": _extract_worker_count(text),
        "height": _extract_first_number(
            text,
            [
                r"(?:高处|高空|高度|作业高度)[^\d]{0,8}(\d+(?:\.\d+)?)\s*米",
                r"(\d+(?:\.\d+)?)\s*米[^\n]{0,8}(?:高处|高空|作业)",
            ],
        ),
        "pit_depth": _extract_first_number(
            text,
            [
                r"(?:基坑|地坑|沟槽|坑深|深度)[^\d]{0,8}(\d+(?:\.\d+)?)\s*米",
                r"(\d+(?:\.\d+)?)\s*米[^\n]{0,8}(?:基坑|地坑|沟槽|井下)",
            ],
        ),
        "has_height": _contains_any(text, HEIGHT_KEYWORDS),
        "has_pit": _contains_any(text, PIT_KEYWORDS),
        "has_hot_work": _contains_any(text, HOT_WORK_KEYWORDS),
        "has_lifting": _contains_any(text, LIFTING_KEYWORDS),
        "has_electrical": _contains_any(text, ELECTRICAL_KEYWORDS),
        "has_excavation": _contains_any(text, EXCAVATION_KEYWORDS),
        "environment_known": _contains_any(text, ENVIRONMENT_KEYWORDS),
    }


def _latest_user_message(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message["role"] == "user":
            return str(message["content"]).strip()
    return ""


def _build_deterministic_question(messages: list[dict]) -> Optional[str]:
    facts = _extract_scene_facts(messages)
    latest = _latest_user_message(messages)
    if latest in {"有", "没有", "无", "不存在"}:
        return None

    if facts["has_pit"] and facts["pit_depth"] is None:
        return "基坑或沟槽深度是多少米？"

    if facts["has_height"] and facts["height"] is None:
        return "作业高度大约多少米？"

    if facts["workers"] is None:
        return "现场计划几个人施工？"

    if (facts["has_pit"] or facts["has_height"]) and not facts["environment_known"]:
        return "作业半径内是否存在高压线、地下管线、积水、淤泥或其他周边障碍？"

    return None


def _infer_permits(messages: list[dict], ai_permits: Optional[list]) -> list[dict]:
    facts = _extract_scene_facts(messages)
    permits: list[dict] = []
    seen: set[str] = set()

    def add_permit(permit_type: str, reason: str) -> None:
        if permit_type in seen:
            return
        seen.add(permit_type)
        permits.append(
            {
                "type": permit_type,
                "label": PERMIT_LABELS.get(permit_type, permit_type),
                "reason": reason,
            }
        )

    for permit in ai_permits or []:
        if isinstance(permit, dict) and permit.get("type"):
            add_permit(
                str(permit["type"]),
                str(permit.get("reason") or f"需要办理 {PERMIT_LABELS.get(str(permit['type']), str(permit['type']))}。"),
            )

    if facts["pit_depth"] is not None and facts["pit_depth"] > 1.2:
        add_permit("confined_space", f"基坑或受限空间深度约 {facts['pit_depth']} 米，必须办理受限空间作业票。")

    height = facts["height"]
    if height is not None and height >= 2:
        if height < 5:
            permit_type = "height_level1"
        elif height < 15:
            permit_type = "height_level2"
        elif height < 30:
            permit_type = "height_level3"
        else:
            permit_type = "height_special"
        add_permit(permit_type, f"作业高度约 {height} 米，对应 {PERMIT_LABELS[permit_type]}。")

    if facts["has_hot_work"]:
        add_permit("hot_work_level2", "场景涉及动火或热作业，必须办理动火作业票。")

    if facts["has_lifting"]:
        add_permit("lifting", "场景涉及吊装或起重作业，必须办理吊装作业票。")

    if facts["has_electrical"]:
        add_permit("electrical", "场景涉及临时用电，必须办理临时用电作业票。")

    if facts["has_excavation"]:
        add_permit("excavation", "场景涉及开挖或动土施工，必须办理动土作业票。")

    return permits


def _normalize_checklist_payload(messages: list[dict], parsed: dict) -> dict:
    permits = _infer_permits(messages, parsed.get("permits"))
    items = parsed.get("items") or []
    cleaned_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cleaned_items.append(
            {
                "risk_description": str(item.get("risk_description") or "").strip(),
                "measure": str(item.get("measure") or "").strip(),
                "severity": str(item.get("severity") or "medium").strip().lower(),
            }
        )

    if not cleaned_items:
        cleaned_items = [
            {
                "risk_description": "现场存在未明确识别的施工风险，需要补充专项风险辨识。",
                "measure": "由现场负责人组织班前交底并补充控制措施。",
                "severity": "medium",
            }
        ]

    return {
        "type": "checklist",
        "summary": str(parsed.get("summary") or "AI 生成作业任务").strip(),
        "permits": permits,
        "items": cleaned_items,
    }


def chat(
    session_id: Optional[str],
    user_message: str,
    db: Session,
    provider_id: Optional[str] = None,
) -> tuple[str, str, str]:
    if not session_id or session_id not in _sessions:
        session_id = str(uuid.uuid4())[:8]
        _sessions[session_id] = [{"role": "system", "content": SYSTEM_PROMPT}]

    messages = _sessions[session_id]
    messages.append({"role": "user", "content": user_message})

    deterministic_question = _build_deterministic_question(messages)
    if deterministic_question:
        content = json.dumps({"type": "question", "content": deterministic_question}, ensure_ascii=False)
        messages.append({"role": "assistant", "content": content})
        return session_id, "question", content

    provider = ai_config_service.get_runtime_provider(db, provider_id)
    if not provider:
        messages.pop()
        raise ValueError("AI 接口尚未配置，请先在系统设置中补全可用的 AI 服务。")

    base_url = ai_config_service.normalize_base_url(provider.get("base_url", ""))
    api_key = str(provider.get("api_key") or "").strip()
    model = str(provider.get("model") or "deepseek-chat").strip()
    if not base_url or not api_key:
        messages.pop()
        raise ValueError("当前选中的 AI 接口未完整配置，请先在系统设置中补全地址和 API Key。")

    try:
        with httpx.Client(timeout=120.0) as client:
            response = client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.1,
                    "max_tokens": 4000,
                },
            )
            if response.status_code != 200:
                response.raise_for_status()

            result = response.json()
            raw_content = result["choices"][0]["message"]["content"]
            ai_content = _normalize_ai_content(raw_content)

            try:
                parsed = json.loads(ai_content)
            except json.JSONDecodeError:
                parsed = {"type": "question", "content": ai_content}

            if parsed.get("type") == "checklist":
                normalized = _normalize_checklist_payload(messages, parsed)
            else:
                normalized = {
                    "type": "question",
                    "content": str(parsed.get("content") or ai_content).strip(),
                }

            content = json.dumps(normalized, ensure_ascii=False)
            messages.append({"role": "assistant", "content": content})
            return session_id, normalized["type"], content
    except httpx.HTTPStatusError as exc:
        messages.pop()
        raise ValueError(
            f"AI 请求失败（上游 {exc.response.status_code}）：{_extract_upstream_error_text(exc.response)}"
        ) from exc
    except httpx.RequestError as exc:
        messages.pop()
        raise ValueError(f"AI 网络请求失败：{exc}") from exc
    except Exception as exc:
        messages.pop()
        raise ValueError(f"AI 服务异常：{exc}") from exc


def get_session_messages(session_id: str) -> list[dict]:
    return _sessions.get(session_id, [])


def get_last_checklist(session_id: str) -> Optional[dict]:
    messages = _sessions.get(session_id, [])
    for message in reversed(messages):
        if message["role"] != "assistant":
            continue
        try:
            parsed = json.loads(_normalize_ai_content(message["content"]))
        except Exception:
            continue
        if parsed.get("type") == "checklist":
            return parsed
    return None


def clear_session(session_id: str) -> None:
    _sessions.pop(session_id, None)
