import json
import re
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.services import ai_config_service

_sessions: dict[str, list[dict]] = {}

SYSTEM_PROMPT = """
你是一位建筑施工安全风险分析专家。
你必须只返回 JSON，不要输出任何额外解释、标题、markdown 或代码块。

当信息不足时，只返回：
{
  "type": "question",
  "content": "请一次性补充以下信息：\\n1. ...\\n2. ...\\n3. ..."
}

要求：
1. 优先一次提出 3 到 5 个关键问题，不要一轮只问 1 个。
2. 问题必须贴合作业场景，尽量追问会直接影响票证、风险等级和控制措施的信息。
3. 如果用户已经回答过，不要重复追问。

当信息足够时，只返回：
{
  "type": "checklist",
  "summary": "一句话任务标题",
  "permits": [
    {"type": "height_level2", "reason": "为什么必须办理"}
  ],
  "items": [
    {
      "risk_description": "风险是什么",
      "inspection_points": "现场要排查什么、怎么判断是否存在隐患",
      "photo_requirements": "要求安全员拍什么照片作为佐证",
      "measure": "发现问题后如何整改或控制",
      "severity": "high"
    }
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
2. items 至少输出 8 条，尽量覆盖人、机、料、法、环、管理。
3. severity 只能是 low / medium / high。
4. 所有内容必须是简体中文。
5. inspection_points 必须写清楚安全员到现场如何排查，比如脚手架要看步距、立杆、连墙件、剪刀撑、基础；高坠要看安全带、挂点、临边防护；临时用电要看配电箱、漏保、电缆；受限空间要看气体检测、通风、监护。
6. photo_requirements 必须明确告诉安全员拍什么，不要只写“拍照留存”。
7. measure 必须是发现问题后的整改或控制要求，不能和 inspection_points 重复。
"""

PERMIT_LABELS = {
    "confined_space": "受限空间作业票",
    "height_level1": "一级高处作业票",
    "height_level2": "二级高处作业票",
    "height_level3": "三级高处作业票",
    "height_special": "特级高处作业票",
    "hot_work_level1": "一级动火作业票",
    "hot_work_level2": "二级动火作业票",
    "hot_work_level3": "普通动火作业票",
    "lifting": "吊装作业票",
    "excavation": "动土作业票",
    "electrical": "临时用电作业票",
    "other": "其他作业票",
}

HEIGHT_KEYWORDS = (
    "高处",
    "高空",
    "外墙",
    "脚手架",
    "登高",
    "登高车",
    "吊篮",
    "梯子",
    "升降平台",
    "临边",
)
PIT_KEYWORDS = ("基坑", "地坑", "沟槽", "坑内", "井下", "池内", "槽内")
HOT_WORK_KEYWORDS = ("动火", "焊接", "切割", "明火", "气割", "电焊")
LIFTING_KEYWORDS = ("吊装", "起重", "吊车", "汽车吊", "塔吊", "吊运")
ELECTRICAL_KEYWORDS = ("临时用电", "临电", "配电箱", "电缆", "接电", "带电")
EXCAVATION_KEYWORDS = ("动土", "开挖", "土方", "挖沟", "挖槽", "探坑")
PAINT_KEYWORDS = ("刷墙", "刷漆", "喷漆", "油漆", "防腐", "涂料", "腻子")
CONFINED_HINT_KEYWORDS = ("有限空间", "受限空间", "污水池", "水池", "井", "罐", "箱涵", "管廊")
ACCESS_KEYWORDS = (
    "脚手架",
    "登高车",
    "高空车",
    "吊篮",
    "梯子",
    "升降平台",
    "曲臂车",
    "直臂车",
    "作业平台",
    "马凳",
)
PROTECTION_KEYWORDS = (
    "安全带",
    "生命绳",
    "挂点",
    "防护栏",
    "围栏",
    "警戒线",
    "监护人",
    "旁站",
    "硬隔离",
)
VENTILATION_KEYWORDS = ("通风", "送风", "排风", "风机", "气体检测", "检测仪", "有毒有害", "氧气")
ENVIRONMENT_KEYWORDS = ("高压线", "地下管线", "管线", "积水", "淤泥", "易燃", "障碍", "车辆通行")
NEGATIVE_ANSWERS = {"没有", "无", "不是", "不存在", "不用", "未使用", "未涉及", "否"}


def _normalize_ai_content(content: str) -> str:
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _joined_user_text(messages: list[dict]) -> str:
    return "\n".join(str(item["content"]) for item in messages if item["role"] == "user")


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _extract_first_number(text: str, patterns: list[str]) -> Optional[float]:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
    return None


def _extract_worker_count(text: str) -> Optional[int]:
    for pattern in [
        r"(\d+)\s*人(?:施工|作业|操作|进入)?",
        r"(?:共|计划|安排)?\s*(\d+)\s*名(?:人员|工人)?",
    ]:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


def _extract_reply_number(text: str) -> Optional[float]:
    stripped = str(text).strip()
    match = re.fullmatch(r"(?:约|大约)?\s*(\d+(?:\.\d+)?)\s*(?:米|m)?", stripped)
    if match:
        return float(match.group(1))
    return None


def _latest_user_message(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message["role"] == "user":
            return str(message["content"]).strip()
    return ""


def _extract_scene_facts(messages: list[dict]) -> dict:
    text = _joined_user_text(messages)
    latest = _latest_user_message(messages)
    previous_user_text = "\n".join(
        str(item["content"]) for item in messages[:-1] if item["role"] == "user"
    )
    lower_text = text.lower()

    height = _extract_first_number(
        text,
        [
            r"(?:高处|高空|高度|作业高度)[^\d]{0,8}(\d+(?:\.\d+)?)\s*米",
            r"(\d+(?:\.\d+)?)\s*米[^\n]{0,8}(?:高处|高空|作业)",
        ],
    )
    pit_depth = _extract_first_number(
        text,
        [
            r"(?:基坑|地坑|沟槽|坑深|深度)[^\d]{0,8}(\d+(?:\.\d+)?)\s*米",
            r"(\d+(?:\.\d+)?)\s*米[^\n]{0,8}(?:基坑|地坑|沟槽|井下|坑内)",
        ],
    )

    short_number_reply = _extract_reply_number(latest)
    if short_number_reply is not None:
        if pit_depth is None and _contains_any(previous_user_text, PIT_KEYWORDS):
            pit_depth = short_number_reply
        elif height is None and _contains_any(previous_user_text, HEIGHT_KEYWORDS):
            height = short_number_reply

    return {
        "text": text,
        "workers": _extract_worker_count(text),
        "height": height,
        "pit_depth": pit_depth,
        "has_height": _contains_any(text, HEIGHT_KEYWORDS),
        "has_pit": _contains_any(text, PIT_KEYWORDS),
        "has_hot_work": _contains_any(text, HOT_WORK_KEYWORDS),
        "has_lifting": _contains_any(text, LIFTING_KEYWORDS),
        "has_electrical": _contains_any(text, ELECTRICAL_KEYWORDS),
        "has_excavation": _contains_any(text, EXCAVATION_KEYWORDS),
        "has_paint": _contains_any(text, PAINT_KEYWORDS),
        "confined_hint": _contains_any(text, CONFINED_HINT_KEYWORDS),
        "access_known": _contains_any(text, ACCESS_KEYWORDS),
        "protection_known": _contains_any(text, PROTECTION_KEYWORDS),
        "ventilation_known": _contains_any(text, VENTILATION_KEYWORDS),
        "environment_known": _contains_any(text, ENVIRONMENT_KEYWORDS),
        "mentions_negative": any(word in lower_text for word in NEGATIVE_ANSWERS),
    }


def _add_question(questions: list[str], question: str) -> None:
    if question and question not in questions:
        questions.append(question)


def _build_deterministic_question(messages: list[dict]) -> Optional[str]:
    facts = _extract_scene_facts(messages)
    latest = _latest_user_message(messages)

    if latest in NEGATIVE_ANSWERS:
        return None

    questions: list[str] = []

    if not any(
        [
            facts["has_height"],
            facts["has_pit"],
            facts["has_hot_work"],
            facts["has_lifting"],
            facts["has_electrical"],
            facts["has_excavation"],
            facts["has_paint"],
            facts["confined_hint"],
        ]
    ):
        _add_question(questions, "具体是什么作业，作业位置在哪里？")
        _add_question(questions, "作业高度或深度大约多少米？")
        _add_question(questions, "计划几个人施工，使用什么设备或机具？")
        _add_question(questions, "周边是否有通行人员、管线、积水、带电或易燃风险？")

    if facts["has_pit"] and facts["pit_depth"] is None:
        _add_question(questions, "地坑、基坑或沟槽深度大约多少米？")

    if facts["has_height"] and facts["height"] is None:
        _add_question(questions, "实际离地作业高度大约多少米？")

    if facts["workers"] is None:
        _add_question(questions, "现场计划几个人施工，是否有人专职监护？")

    if facts["has_pit"] and not facts["access_known"]:
        _add_question(
            questions,
            "作业人员是在坑底地面作业，还是要在坑内脚手架、登高车、吊篮或梯子上作业？请一次说明使用的登高方式。",
        )
    elif (facts["has_height"] or (facts["pit_depth"] or 0) >= 2) and not facts["access_known"]:
        _add_question(questions, "准备使用脚手架、登高车、吊篮、梯子还是其他登高机具？设备是否已验收？")

    if (facts["has_height"] or (facts["pit_depth"] or 0) >= 2) and not facts["protection_known"]:
        _add_question(questions, "是否设置安全带挂点、临边防护、围栏警戒，并安排现场监护？")

    if (facts["has_paint"] and (facts["has_pit"] or facts["confined_hint"])) and not facts["ventilation_known"]:
        _add_question(questions, "坑内或受限位置刷墙时，是否已做通风换气、气体检测，使用的涂料是否易燃或有刺激性？")
    elif (facts["confined_hint"] or facts["has_pit"]) and not facts["ventilation_known"]:
        _add_question(questions, "作业空间是否需要通风、气体检测或持续监测？")

    if (
        facts["has_height"]
        or facts["has_pit"]
        or facts["has_hot_work"]
        or facts["has_lifting"]
        or facts["has_excavation"]
    ) and not facts["environment_known"]:
        _add_question(questions, "作业周边是否有高压线、地下管线、积水淤泥、车辆通行、障碍物或其他交叉作业？")

    if facts["has_hot_work"] and "动火等级" not in facts["text"] and not re.search(r"[一二三123]级动火", facts["text"]):
        _add_question(questions, "如果涉及动火，请说明是焊接、切割还是明火作业，周边是否有可燃物，计划按几级动火管理？")

    if facts["has_lifting"] and not re.search(r"(起重量|吊重|重量|吨)", facts["text"]):
        _add_question(questions, "如果涉及吊装，请补充吊装重量、吊装范围，以及吊物下方是否有人通行或停留。")

    if facts["has_electrical"] and "配电箱" not in facts["text"] and "漏保" not in facts["text"]:
        _add_question(questions, "如果涉及临时用电，请补充电源接入方式、配电箱位置，以及是否有漏电保护和电缆防护。")

    if facts["has_excavation"] and not re.search(r"(放坡|支护|支撑|开挖深度)", facts["text"]):
        _add_question(questions, "如果涉及开挖或动土，请补充开挖深度，以及是否已经放坡、支护或探明地下管线。")

    if not questions:
        return None

    selected = questions[:5]
    lines = [f"{index}. {question}" for index, question in enumerate(selected, start=1)]
    return "为一次性完成风险分析，请补充以下信息：\n" + "\n".join(lines)


# Users often answer numbered follow-up questions in one sentence. Keep this
# deterministic layer UTF-8 and conservative so answered facts are not repeated.
CN_NEGATIVE_RE = re.compile(r"(没有|无|不存在|不涉及|不用|未涉及|否)")
CN_PIT_RE = re.compile(r"(地坑|基坑|沟槽|坑内|坑底|井下|池内|受限空间)")
CN_HEIGHT_RE = re.compile(r"(高处|登高|高空|临边|吊篮|脚手架|升降平台|登高车|梯子)")
CN_HOT_RE = re.compile(r"(动火|焊接|切割|明火|气割|电焊)")
CN_LIFT_RE = re.compile(r"(吊装|起重|吊车|塔吊|吊运)")
CN_ELEC_RE = re.compile(r"(临时用电|配电箱|电缆|接电|带电)")
CN_EXCAVATION_RE = re.compile(r"(动土|开挖|土方|挖沟|挖槽)")
CN_PAINT_RE = re.compile(r"(刷墙|刷漆|喷漆|油漆|防腐|涂料)")
CN_ACCESS_RE = re.compile(r"(脚手架|登高车|高空车|吊篮|梯子|升降平台|作业平台)")
CN_PROTECTION_RE = re.compile(r"(安全带|生命绳|挂点|临边防护|围栏|警戒|监护|看护|专职)")
CN_VENT_RE = re.compile(r"(通风|换气|送风|排风|气体检测|气体监测|检测仪|有毒|有害|易燃|刺激)")
CN_ENV_RE = re.compile(r"(高压线|地下管线|管线|积水|淤泥|车辆|通行|障碍|交叉作业)")


def _numbered_answers(text: str) -> dict[int, str]:
    normalized = re.sub(r"\s+", "", str(text or ""))
    # Accept compact answers like "1.5米，2有监护，5人施工，3用脚手架4没有5没有".
    # Avoid treating "5人" as question 5 by only inserting markers before likely
    # answer words for each question.
    markers = {
        2: r"(?:有|没|无|专职|\d+人)",
        3: r"(?:坑|地面|用|脚手架|登高|吊篮|梯子|平台)",
        4: r"(?:没有|无|有|通风|换气|气体|涂料|油漆)",
        5: r"(?:没有|无|有高压|高压|地下|积水|车辆|障碍|交叉)",
    }
    for number, marker in markers.items():
        normalized = re.sub(rf"(?<![\d.]){number}(?={marker})", f"{number}.", normalized)
    answers: dict[int, str] = {}
    for match in re.finditer(r"([1-5])[\.\、:：,，]\s*(.*?)(?=(?:[1-5][\.\、:：,，])|$)", normalized):
        answers[int(match.group(1))] = match.group(2).strip("，,。；; ")
    return answers


def _latest_assistant_message(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message["role"] == "assistant":
            return str(message["content"]).strip()
    return ""


def _has_negative_answer(value: str) -> bool:
    return bool(CN_NEGATIVE_RE.search(str(value or "")))


def _extract_number_before_unit(text: str, unit_pattern: str) -> Optional[float]:
    match = re.search(rf"(\d+(?:\.\d+)?)\s*{unit_pattern}", str(text or ""))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _extract_scene_facts(messages: list[dict]) -> dict:
    text = _joined_user_text(messages)
    latest = _latest_user_message(messages)
    previous_assistant = _latest_assistant_message(messages)
    answers = _numbered_answers(latest)

    pit_depth = _extract_first_number(
        text,
        [
            r"(?:地坑|基坑|沟槽|坑|井|池|深度)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:米|m)",
            r"(\d+(?:\.\d+)?)\s*(?:米|m)[^\n，。；;]{0,12}(?:地坑|基坑|沟槽|坑|井|池)",
        ],
    )
    height = _extract_first_number(
        text,
        [
            r"(?:高处|登高|高空|高度|离地)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:米|m)",
            r"(\d+(?:\.\d+)?)\s*(?:米|m)[^\n，。；;]{0,12}(?:高处|登高|高空|离地)",
        ],
    )
    workers = _extract_worker_count(text) or None

    explicit_height_text = bool(re.search(r"(?:高处|登高|高空|高度|离地)[^\d]{0,12}\d+(?:\.\d+)?\s*(?:米|m)", text))

    if 1 in answers:
        answer_depth = _extract_number_before_unit(answers[1], r"(?:米|m)")
        if answer_depth is not None:
            pit_depth = answer_depth
            if CN_HEIGHT_RE.search(answers[1]):
                height = height if height is not None else answer_depth
            elif not explicit_height_text:
                height = None
    if 2 in answers:
        answer_workers = re.search(r"(\d+)\s*(?:人|个人)", answers[2])
        if answer_workers:
            workers = int(answer_workers.group(1))
    if workers is None:
        worker_match = re.search(r"(\d+)\s*(?:人|个人)", text)
        if worker_match:
            workers = int(worker_match.group(1))

    access_known = bool(CN_ACCESS_RE.search(text) or CN_ACCESS_RE.search(answers.get(3, "")))
    protection_known = bool(CN_PROTECTION_RE.search(text) or CN_PROTECTION_RE.search(answers.get(2, "")) or CN_PROTECTION_RE.search(answers.get(3, "")))
    latest_is_negative = _has_negative_answer(latest)
    latest_answers_environment = latest_is_negative and bool(re.search(r"(周边|高压线|地下管线|积水|车辆|障碍|交叉)", previous_assistant))
    latest_answers_ventilation = latest_is_negative and bool(re.search(r"(通风|换气|气体|涂料|易燃|刺激)", previous_assistant))

    ventilation_known = bool(CN_VENT_RE.search(text) or _has_negative_answer(answers.get(4, "")) or latest_answers_ventilation)
    environment_known = bool(CN_ENV_RE.search(text) or _has_negative_answer(answers.get(5, "")) or latest_answers_environment)

    return {
        "text": text,
        "workers": workers,
        "height": height,
        "pit_depth": pit_depth,
        "has_height": bool(CN_HEIGHT_RE.search(text)),
        "has_pit": bool(CN_PIT_RE.search(text)),
        "has_hot_work": bool(CN_HOT_RE.search(text)),
        "has_lifting": bool(CN_LIFT_RE.search(text)),
        "has_electrical": bool(CN_ELEC_RE.search(text)),
        "has_excavation": bool(CN_EXCAVATION_RE.search(text)),
        "has_paint": bool(CN_PAINT_RE.search(text)),
        "confined_hint": bool(re.search(r"(受限空间|有限空间|池内|井下|坑内)", text)),
        "access_known": access_known,
        "protection_known": protection_known,
        "ventilation_known": ventilation_known,
        "environment_known": environment_known,
        "mentions_negative": bool(CN_NEGATIVE_RE.search(text)),
    }


def _build_deterministic_question(messages: list[dict]) -> Optional[str]:
    facts = _extract_scene_facts(messages)
    questions: list[str] = []

    has_known_work = any(
        [
            facts["has_height"],
            facts["has_pit"],
            facts["has_hot_work"],
            facts["has_lifting"],
            facts["has_electrical"],
            facts["has_excavation"],
            facts["has_paint"],
            facts["confined_hint"],
        ]
    )

    if not has_known_work:
        _add_question(questions, "具体是什么作业，作业位置在哪里？")
        _add_question(questions, "作业高度或坑、井、池、沟槽深度大约多少米？")
        _add_question(questions, "计划几个人施工，是否有人专职监护？")
        _add_question(questions, "使用脚手架、登高车、吊篮、梯子还是其他机具？")
        _add_question(questions, "周边是否有高压线、地下管线、积水淤泥、车辆通行、障碍物或交叉作业？")

    if facts["has_pit"] and facts["pit_depth"] is None:
        _add_question(questions, "地坑、基坑或沟槽深度大约多少米？")
    if facts["has_height"] and facts["height"] is None and not facts["has_pit"]:
        _add_question(questions, "实际离地作业高度大约多少米？")
    if facts["workers"] is None:
        _add_question(questions, "现场计划几个人施工，是否有人专职监护？")
    if (facts["has_pit"] or facts["has_height"] or (facts["pit_depth"] or 0) >= 2) and not facts["access_known"]:
        _add_question(questions, "人员是在坑底地面作业，还是使用脚手架、登高车、吊篮、梯子等方式作业？请一次说明登高或作业平台方式。")
    if (facts["has_height"] or (facts["pit_depth"] or 0) >= 2) and not facts["protection_known"]:
        _add_question(questions, "是否设置安全带挂点、临边防护、围栏警戒，并安排现场监护？")
    if (facts["has_paint"] and (facts["has_pit"] or facts["confined_hint"])) and not facts["ventilation_known"]:
        _add_question(questions, "坑内或受限位置刷墙时，是否已做通风换气、气体检测，涂料是否易燃或有刺激性？")
    if (facts["has_pit"] or facts["has_height"] or facts["has_excavation"]) and not facts["environment_known"]:
        _add_question(questions, "作业周边是否有高压线、地下管线、积水淤泥、车辆通行、障碍物或其他交叉作业？")

    if not questions:
        return None

    selected = questions[:5]
    lines = [f"{index}. {question}" for index, question in enumerate(selected, start=1)]
    return "为一次性完成风险分析，请补充以下信息：\n" + "\n".join(lines)


def _infer_hot_work_level(text: str) -> str:
    if "一级动火" in text or "1级动火" in text or "重点动火" in text or "特殊动火" in text or "特级动火" in text:
        return "hot_work_level1"
    if "二级动火" in text or "2级动火" in text:
        return "hot_work_level2"
    if "普通动火" in text or "三级动火" in text or "3级动火" in text:
        return "hot_work_level3"
    return "hot_work_level3"


def _build_combined_measure(
    inspection_points: str,
    photo_requirements: str,
    measure: str,
) -> str:
    parts = []
    if inspection_points:
        parts.append(f"排查要点：{inspection_points}")
    if photo_requirements:
        parts.append(f"拍照要求：{photo_requirements}")
    if measure:
        parts.append(f"整改要求：{measure}")
    return "\n".join(parts).strip()


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
            permit_type = str(permit["type"])
            add_permit(
                permit_type,
                str(permit.get("reason") or f"需要办理 {PERMIT_LABELS.get(permit_type, permit_type)}。"),
            )

    if facts["pit_depth"] is not None and facts["pit_depth"] > 1.2:
        add_permit(
            "confined_space",
            f"坑槽或受限位置深度约 {facts['pit_depth']} 米，需核查受限空间风险并办理受限空间作业票。",
        )

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
        permit_type = _infer_hot_work_level(facts["text"])
        add_permit(permit_type, f"场景涉及动火或热作业，需要办理 {PERMIT_LABELS[permit_type]}。")

    if facts["has_lifting"]:
        add_permit("lifting", "场景涉及吊装或起重作业，需要办理吊装作业票。")

    if facts["has_electrical"]:
        add_permit("electrical", "场景涉及临时用电，需要办理临时用电作业票。")

    if facts["has_excavation"]:
        add_permit("excavation", "场景涉及开挖或动土施工，需要办理动土作业票。")

    return permits


def _normalize_checklist_payload(messages: list[dict], parsed: dict) -> dict:
    permits = _infer_permits(messages, parsed.get("permits"))
    items = parsed.get("items") or []
    cleaned_items = []

    for item in items:
        if not isinstance(item, dict):
            continue

        severity = str(item.get("severity") or "medium").strip().lower()
        if severity not in {"low", "medium", "high"}:
            severity = "medium"

        inspection_points = str(
            item.get("inspection_points")
            or item.get("inspection_method")
            or item.get("check_method")
            or ""
        ).strip()
        photo_requirements = str(
            item.get("photo_requirements")
            or item.get("photo_requirement")
            or item.get("photo_points")
            or ""
        ).strip()
        measure = str(
            item.get("measure")
            or item.get("control_measure")
            or item.get("control_measures")
            or ""
        ).strip()

        cleaned_items.append(
            {
                "risk_description": str(item.get("risk_description") or "").strip(),
                "inspection_points": inspection_points,
                "photo_requirements": photo_requirements,
                "measure": _build_combined_measure(
                    inspection_points=inspection_points,
                    photo_requirements=photo_requirements,
                    measure=measure,
                ),
                "severity": severity,
            }
        )

    if not cleaned_items:
        fallback_inspection = "由安全员对现场作业条件、设备状态、人员防护、周边环境和票证落实情况逐项排查。"
        fallback_photo = "拍摄作业面全景、人员站位、防护措施、设备状态和问题细部照片。"
        fallback_measure = "发现隐患后立即停止相关作业，补充交底并落实控制措施后方可恢复施工。"
        cleaned_items = [
            {
                "risk_description": "现场存在尚未完全识别的施工风险，需要补充专项风险辨识。",
                "inspection_points": fallback_inspection,
                "photo_requirements": fallback_photo,
                "measure": _build_combined_measure(
                    inspection_points=fallback_inspection,
                    photo_requirements=fallback_photo,
                    measure=fallback_measure,
                ),
                "severity": "medium",
            }
        ]

    return {
        "type": "checklist",
        "summary": str(parsed.get("summary") or "AI 生成作业任务").strip(),
        "permits": permits,
        "items": cleaned_items,
    }


def _count_user_turns(messages: list[dict]) -> int:
    return sum(1 for m in messages if m["role"] == "user")


def _already_asked_questions(messages: list[dict]) -> set[str]:
    """Collect question strings that appeared in previous assistant messages."""
    asked: set[str] = set()
    for m in messages:
        if m["role"] != "assistant":
            continue
        try:
            parsed = json.loads(_normalize_ai_content(m["content"]))
        except Exception:
            continue
        content_text = str(parsed.get("content") or "")
        for line in content_text.splitlines():
            line = re.sub(r"^\d+[\.\、]\s*", "", line.strip())
            if line:
                asked.add(line)
    return asked


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

    # ── Build a transient hint injected into the API call (not persisted) ──
    api_messages = list(messages)  # shallow copy
    user_turns = _count_user_turns(messages)

    if user_turns >= 3:
        # After 3 rounds of user input, push the AI to finalize
        api_messages.append({
            "role": "system",
            "content": (
                "用户已经补充了足够多的信息。"
                "请直接根据已有对话内容输出 checklist JSON，不要再追问。"
                "如果某些细节确实不明确，按最常见的施工场景做合理假设并在 items 中标注。"
            ),
        })
    elif user_turns >= 2:
        # Second round: nudge toward finalizing, allow one last question
        api_messages.append({
            "role": "system",
            "content": (
                "这已经是用户的第二轮补充了。如果还缺关键信息（如高度、深度、人数），"
                "最多再追问 1-2 个关键问题。如果信息已经基本够了，直接输出 checklist。"
            ),
        })
    else:
        # First round: inject deterministic hints as guidance, but let AI decide
        deterministic_hint = _build_deterministic_question(messages)
        if deterministic_hint:
            already_asked = _already_asked_questions(messages)
            # Filter out questions that were already asked
            hint_lines = []
            for line in deterministic_hint.splitlines():
                clean = re.sub(r"^\d+[\.\、]\s*", "", line.strip())
                if clean and clean not in already_asked:
                    hint_lines.append(line)
            if hint_lines:
                api_messages.append({
                    "role": "system",
                    "content": (
                        "以下是系统根据场景关键词分析出的可能缺失信息，供参考。"
                        "请结合用户已提供的内容判断是否还需要追问，不要重复已回答的问题：\n"
                        + "\n".join(hint_lines)
                    ),
                })


    try:
        _used_provider, result = ai_config_service.request_chat_completion(
            db,
            messages=api_messages,
            provider_id=provider_id,
            temperature=0.1,
            max_tokens=4000,
            timeout=120.0,
        )
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
