import json
import re
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.services import ai_config_service

_sessions: dict[str, list[dict]] = {}

SYSTEM_PROMPT = """
你是一位工程施工质量控制专家，负责把用户描述的施工场景分析成可下发的质量检查任务。
你必须只返回 JSON，不要输出解释、markdown、代码块或 <think> 内容。

当信息不足时，只返回：
{
  "type": "question",
  "content": "请一次性补充以下信息：\\n1. ...\\n2. ...\\n3. ..."
}

提问要求：
1. 最多一次问 3 到 5 个关键问题，不要展开成很多问题。
2. 只追问会影响质量验收和过程控制的内容，例如施工部位、工序、材料、尺寸标高、验收标准、隐蔽工程、试验检测、样板或成品保护。
3. 用户已经说明过的信息不要重复追问。

当信息足够时，只返回：
{
  "type": "checklist",
  "summary": "一句话质量控制任务标题",
  "permits": [],
  "items": [
    {
      "risk_description": "质量控制点或质量风险是什么",
      "inspection_points": "现场怎么检查，验收标准或允许偏差是什么",
      "photo_requirements": "要拍哪些质量佐证照片",
      "measure": "发现质量问题后如何处理、复验或整改闭环",
      "severity": "medium"
    }
  ]
}

输出约束：
1. permits 必须是空数组 []，质量控制不生成作业许可。
2. items 根据工序复杂度输出足够数量，不要固定为 12 条；一般工序 8 到 16 条，复杂工序可输出 16 到 24 条，覆盖材料进场、施工准备、过程控制、实测实量、隐蔽验收、试验检测、成品保护、资料闭环。
3. severity 只能是 low / medium / high。
4. 所有内容必须是简体中文，语言要能直接给现场人员执行。
5. inspection_points 要写清楚怎么查、查什么标准，不要只写“检查质量”。
6. photo_requirements 要明确要拍什么照片，不要只写“拍照留存”。
7. measure 要写发现问题后的整改、停工、返工、复验或资料补充要求。
8. 识别到滑模施工时，必须包含混凝土和易性、分层连续浇筑、滑升速度、出模强度、垂直度/扭转、钢筋保护层、预埋洞口、出模后表面收面修整、养护防裂、停滑施工缝等质量控制点。
"""

MAX_QUALITY_ITEMS = 32

QUALITY_PROCESS_TEMPLATES = [
    {
        "name": "滑模施工",
        "keywords": ("滑模", "滑升", "滑动模板"),
        "items": [
            {
                "anchors": ("专项方案", "滑模平台", "技术交底"),
                "risk_description": "滑模施工准备和技术交底不到位，影响连续施工质量。",
                "inspection_points": "核查滑模专项方案、技术交底、测量控制点、滑模平台调试记录和班组分工，确认模板、围圈、千斤顶、液压系统、限位装置已验收合格。",
                "photo_requirements": "拍摄专项方案/交底签字页、滑模平台整体、千斤顶和液压控制台、测量控制点。",
                "measure": "资料或设备验收不完整时暂停滑升，补齐交底和平台调试验收后再开始施工。",
                "severity": "high",
            },
            {
                "anchors": ("坍落度", "和易性", "初凝"),
                "risk_description": "混凝土坍落度、和易性或初凝时间不符合滑模连续施工要求。",
                "inspection_points": "检查配合比通知单、开盘鉴定、坍落度实测值、入模温度和初凝时间控制，确认混凝土满足连续入模、出模不塌落、不拉裂要求。",
                "photo_requirements": "拍摄配合比资料、坍落度检测、试块留置、混凝土入模状态。",
                "measure": "坍落度或和易性异常时停止使用该车混凝土，通知搅拌站调整并重新检测合格后入模。",
                "severity": "high",
            },
            {
                "anchors": ("分层浇筑", "连续浇筑", "供料"),
                "risk_description": "混凝土分层厚度、入模顺序或连续供料控制不当。",
                "inspection_points": "核查每层浇筑厚度、四周对称均衡下料、振捣密实情况和供料连续性，避免局部堆料、漏振、冷缝或模板受力不均。",
                "photo_requirements": "拍摄分层下料、振捣过程、作业面连续浇筑状态和混凝土交接记录。",
                "measure": "发现下料不均或供料中断时立即调整浇筑顺序，必要时按停滑施工缝要求处理。",
                "severity": "high",
            },
            {
                "anchors": ("滑升速度", "提升速度", "出模强度"),
                "risk_description": "滑升速度与混凝土出模强度不匹配，造成拉裂、塌落或粘模。",
                "inspection_points": "核查滑升速度记录、混凝土出模强度判断、脱模状态和表面成型质量，确认提升间隔和速度随温度、凝结时间及时调整。",
                "photo_requirements": "拍摄滑升记录、出模混凝土状态、模板下口成型面、速度控制记录。",
                "measure": "出模强度不足或粘模时降低滑升速度或暂停滑升，查明混凝土凝结和模板状态后恢复。",
                "severity": "high",
            },
            {
                "anchors": ("垂直度", "中心偏移", "扭转"),
                "risk_description": "滑模结构垂直度、中心偏移或平台扭转超限。",
                "inspection_points": "按测量方案复核轴线、垂直度、标高、中心偏移和平台扭转，检查纠偏记录，确认偏差在允许范围内并及时纠偏。",
                "photo_requirements": "拍摄经纬仪/全站仪测量、垂直度记录、标高控制点、纠偏前后数据。",
                "measure": "偏差接近或超过控制值时立即组织纠偏，纠偏完成并复测合格后继续滑升。",
                "severity": "high",
            },
            {
                "anchors": ("保护层", "钢筋位置", "钢筋变形", "拖带"),
                "risk_description": "钢筋位置、保护层或钢筋拖带变形影响结构质量。",
                "inspection_points": "检查竖向钢筋、水平钢筋、保护层垫块、钢筋接头和绑扎固定，确认滑升过程中钢筋未被模板拖带、挤偏或污染。",
                "photo_requirements": "拍摄钢筋定位、保护层垫块、钢筋接头、模板通过钢筋位置的细部。",
                "measure": "发现钢筋偏位或保护层不足时立即校正加固，严重偏位按技术方案处理并复验。",
                "severity": "high",
            },
            {
                "anchors": ("预埋", "洞口", "套管"),
                "risk_description": "预埋件、洞口、套管位置偏差或漏设。",
                "inspection_points": "核对图纸和定位线，检查预埋件、洞口模板、套管、拉结筋和止水构造的位置、标高、固定牢固度。",
                "photo_requirements": "拍摄预埋件定位线、洞口模板、套管固定、复核尺寸和隐蔽验收记录。",
                "measure": "发现漏设或偏位时在混凝土成型前及时调整固定，成型后问题按设计和技术核定处理。",
                "severity": "medium",
            },
            {
                "anchors": ("收面", "表面修整", "蜂窝麻面", "出模表面"),
                "risk_description": "出模后表面未及时收面、修整，蜂窝麻面或裂缝处理不到位。",
                "inspection_points": "检查出模后混凝土表面平整度、蜂窝麻面、拉裂、掉角、接茬和污染情况，确认及时压实收面、修补缺陷并形成记录。",
                "photo_requirements": "拍摄出模表面全景、收面修整过程、蜂窝麻面或裂缝细部、修补前后对比。",
                "measure": "表面缺陷未处理不得进入下一步覆盖或交接，按修补方案处理并复验外观质量。",
                "severity": "high",
            },
            {
                "anchors": ("养护", "防裂", "保湿"),
                "risk_description": "滑模出模后养护和防裂措施不到位。",
                "inspection_points": "检查出模后洒水、覆盖、保湿、保温和防风措施，确认养护开始时间、持续时间和责任人符合方案要求。",
                "photo_requirements": "拍摄覆盖养护、洒水保湿、养护记录、易开裂部位防护。",
                "measure": "养护不到位时立即补充覆盖和保湿措施，对已出现裂缝的部位按方案处理并跟踪复查。",
                "severity": "medium",
            },
            {
                "anchors": ("停滑", "施工缝", "接茬"),
                "risk_description": "停滑、续滑或施工缝接茬处理不规范。",
                "inspection_points": "核查停滑原因、停滑时间、接茬凿毛清理、界面处理、续滑前模板和混凝土状态，确认施工缝处理符合方案。",
                "photo_requirements": "拍摄停滑记录、施工缝处理、接茬清理、续滑前验收照片。",
                "measure": "停滑接茬处理不合格时不得续滑，按施工缝处理要求整改并验收。",
                "severity": "high",
            },
        ],
    },
    {
        "name": "混凝土施工",
        "keywords": ("混凝土", "砼", "浇筑", "振捣"),
        "items": [
            {
                "anchors": ("坍落度", "配合比", "试块"),
                "risk_description": "混凝土进场质量、坍落度或试块留置不符合要求。",
                "inspection_points": "核查配合比、开盘鉴定、出厂单、坍落度实测、试块留置组数和见证取样情况。",
                "photo_requirements": "拍摄混凝土小票、坍落度检测、试块制作、见证取样过程。",
                "measure": "检测不合格混凝土不得入模，退场或调整后重新检测合格再使用。",
                "severity": "high",
            },
            {
                "anchors": ("振捣", "漏振", "过振"),
                "risk_description": "混凝土振捣不密实或过振，形成蜂窝、孔洞、离析。",
                "inspection_points": "检查振捣棒间距、插入深度、快插慢拔、分层振捣和边角部位密实情况。",
                "photo_requirements": "拍摄振捣过程、边角节点、分层浇筑面、问题部位细部。",
                "measure": "发现漏振或离析时立即补振或按方案处理，严重质量缺陷报技术负责人确认。",
                "severity": "high",
            },
            {
                "anchors": ("收面", "抹面", "压光"),
                "risk_description": "混凝土浇筑后收面、压光或表面标高控制不到位。",
                "inspection_points": "检查标高控制点、刮平找坡、二次收面、压光时机和表面平整度，确认无起砂、裂缝、积水或错台。",
                "photo_requirements": "拍摄标高控制、刮平收面、压光完成面、平整度检查。",
                "measure": "收面缺陷应在初凝前及时修整，成型后缺陷按修补方案处理并复验。",
                "severity": "medium",
            },
            {
                "anchors": ("养护", "覆盖", "保湿"),
                "risk_description": "混凝土养护不足导致早期裂缝或强度发展受影响。",
                "inspection_points": "检查覆盖、洒水、保湿、保温、养护开始时间和持续时间，确认满足方案和规范要求。",
                "photo_requirements": "拍摄覆盖养护、洒水保湿、养护记录和裂缝易发部位。",
                "measure": "养护不到位时立即补充覆盖保湿，对裂缝进行标识、评估和处理。",
                "severity": "medium",
            },
        ],
    },
    {
        "name": "钢结构安装",
        "keywords": ("钢结构", "钢梁", "钢柱", "高强螺栓", "焊缝"),
        "items": [
            {
                "anchors": ("高强螺栓", "终拧", "初拧"),
                "risk_description": "高强螺栓初拧、终拧、扭矩或标记控制不到位。",
                "inspection_points": "核查高强螺栓规格批号、摩擦面处理、初拧终拧顺序、扭矩记录和终拧标记。",
                "photo_requirements": "拍摄螺栓批号、摩擦面、终拧标记、扭矩检查记录。",
                "measure": "扭矩或顺序不符合要求时重新按工艺复拧，复验合格后记录闭环。",
                "severity": "high",
            },
            {
                "anchors": ("焊缝", "探伤", "外观"),
                "risk_description": "焊缝外观、尺寸或无损检测不满足要求。",
                "inspection_points": "检查焊工证、焊材烘干、焊缝成型、咬边气孔夹渣、焊脚尺寸和探伤报告。",
                "photo_requirements": "拍摄焊缝外观、焊材烘干记录、焊工证、探伤报告或检测过程。",
                "measure": "焊缝缺陷按返修工艺处理，返修后重新外观检查和检测。",
                "severity": "high",
            },
            {
                "anchors": ("垂直度", "轴线", "标高"),
                "risk_description": "钢柱垂直度、轴线、标高或构件安装偏差超限。",
                "inspection_points": "用测量仪器复核轴线、标高、垂直度、连接节点间隙和构件编号方向。",
                "photo_requirements": "拍摄测量仪器读数、构件编号、连接节点和复测记录。",
                "measure": "偏差超限时调整校正，复测合格后再终拧或焊接固定。",
                "severity": "high",
            },
        ],
    },
    {
        "name": "抹灰施工",
        "keywords": ("抹灰", "粉刷", "砂浆", "墙面找平"),
        "items": [
            {
                "anchors": ("基层处理", "界面剂", "拉毛"),
                "risk_description": "抹灰基层处理不到位，导致空鼓、开裂或脱落。",
                "inspection_points": "检查基层清理、浇水湿润、界面剂或拉毛、不同材料交接挂网和灰饼冲筋。",
                "photo_requirements": "拍摄基层清理、界面处理、挂网、灰饼冲筋和隐蔽验收。",
                "measure": "基层未验收不得抹灰，问题基层处理合格后重新报验。",
                "severity": "high",
            },
            {
                "anchors": ("空鼓", "开裂", "厚度"),
                "risk_description": "抹灰厚度、分层施工或养护控制不当，产生空鼓开裂。",
                "inspection_points": "检查分层厚度、砂浆配合比、压实搓毛、终凝养护和空鼓开裂检查。",
                "photo_requirements": "拍摄分层抹灰、厚度检查、空鼓检查、养护状态。",
                "measure": "空鼓开裂部位切除返修，重新抹灰并复查平整度和粘结质量。",
                "severity": "medium",
            },
        ],
    },
    {
        "name": "防水施工",
        "keywords": ("防水", "卷材", "涂膜", "闭水", "蓄水"),
        "items": [
            {
                "anchors": ("基层含水率", "基层处理", "阴阳角"),
                "risk_description": "防水基层处理、含水率或阴阳角圆弧不符合要求。",
                "inspection_points": "检查基层平整度、含水率、浮灰油污、阴阳角圆弧、管根和节点附加层施工条件。",
                "photo_requirements": "拍摄基层处理、含水率检查、阴阳角圆弧、管根节点。",
                "measure": "基层不合格不得施工防水层，整改验收后再进行下道工序。",
                "severity": "high",
            },
            {
                "anchors": ("搭接", "附加层", "闭水"),
                "risk_description": "防水附加层、搭接宽度或闭水试验不符合要求。",
                "inspection_points": "检查附加层范围、卷材搭接宽度、收头密封、涂膜厚度、闭水或淋水试验记录。",
                "photo_requirements": "拍摄附加层、搭接尺量、收头密封、闭水水位和试验记录。",
                "measure": "搭接或试验不合格时返工修补，重新闭水或淋水合格后验收。",
                "severity": "high",
            },
        ],
    },
]


def _normalize_ai_content(content: str) -> str:
    text = str(content or "").strip()
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
    if text.startswith("```json"):
        text = text[7:].strip()
    elif text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1].strip()
        try:
            json.loads(candidate)
            return candidate
        except json.JSONDecodeError:
            pass
    return text


def _split_question_lines(text: str) -> list[str]:
    candidates: list[str] = []
    for line in str(text or "").splitlines():
        cleaned = re.sub(r"^\s*(?:[-*]|[0-9]{1,3}[\.\)、:：])\s*", "", line).strip()
        if cleaned:
            candidates.append(cleaned)
    if len(candidates) <= 1:
        candidates = [
            part.strip()
            for part in re.split(r"(?:^|\s)[0-9]{1,3}[\.\)、:：]\s*", str(text or ""))
            if part.strip()
        ]

    normalized: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        item = re.sub(r"\s+", " ", item).strip()
        if not item:
            continue
        if len(item) > 140:
            item = item[:140].rstrip() + "..."
        key = item.casefold()
        if key not in seen:
            seen.add(key)
            normalized.append(item)
    return normalized


def _normalize_question_payload(parsed: dict, ai_content: str) -> dict:
    raw = str(parsed.get("content") or ai_content or "").strip()
    questions = _split_question_lines(raw)
    if not questions:
        return {"type": "question", "content": raw or "请补充施工部位、工序、材料做法、验收标准和需要检查的质量重点。"}
    lines = [f"{index}. {question}" for index, question in enumerate(questions[:5], start=1)]
    return {"type": "question", "content": "请一次性补充以下信息：\n" + "\n".join(lines)}


def _normalize_text(value, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


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


def _joined_user_text(messages: list[dict]) -> str:
    return "\n".join(str(item["content"]) for item in messages if item.get("role") == "user")


def _item_search_text(item: dict, *, include_measure: bool = True) -> str:
    fields = ["risk_description", "inspection_points", "photo_requirements"]
    if include_measure:
        fields.append("measure")
    return "\n".join(str(item.get(field) or "") for field in fields)


def _contains_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword and keyword in text for keyword in keywords)


def _is_template_item_covered(existing_items: list[dict], template_item: dict) -> bool:
    existing_text = "\n".join(_item_search_text(item, include_measure=False) for item in existing_items)
    anchors = tuple(template_item.get("anchors") or ())
    if anchors:
        return _contains_keyword(existing_text, anchors)

    template_title = str(template_item.get("risk_description") or "")
    title_words = [word for word in re.split(r"[、，。,；;或和\s]+", template_title) if len(word) >= 2]
    return any(word in existing_text for word in title_words[:3])


def _template_item_payload(template_item: dict) -> dict:
    inspection_points = _normalize_text(template_item.get("inspection_points"))
    photo_requirements = _normalize_text(template_item.get("photo_requirements"))
    measure = _normalize_text(template_item.get("measure"))
    severity = str(template_item.get("severity") or "medium").strip().lower()
    if severity not in {"low", "medium", "high"}:
        severity = "medium"
    return {
        "risk_description": _normalize_text(template_item.get("risk_description"), "待确认质量控制点"),
        "inspection_points": inspection_points,
        "photo_requirements": photo_requirements,
        "measure": _build_combined_measure(
            inspection_points=inspection_points,
            photo_requirements=photo_requirements,
            measure=measure,
        ),
        "severity": severity,
    }


def _apply_process_templates(messages: list[dict], parsed: dict, cleaned_items: list[dict]) -> list[dict]:
    search_text = "\n".join(
        [
            _joined_user_text(messages),
            str(parsed.get("summary") or ""),
            "\n".join(_item_search_text(item) for item in cleaned_items),
        ]
    )
    if not search_text.strip():
        return cleaned_items

    enriched_items = list(cleaned_items)
    for template in QUALITY_PROCESS_TEMPLATES:
        if not _contains_keyword(search_text, tuple(template.get("keywords") or ())):
            continue
        for template_item in template.get("items") or []:
            if _is_template_item_covered(enriched_items, template_item):
                continue
            enriched_items.append(_template_item_payload(template_item))
    return enriched_items


def _normalize_checklist_payload(messages: list[dict], parsed: dict) -> dict:
    items = parsed.get("items") or []
    cleaned_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        severity = str(item.get("severity") or "medium").strip().lower()
        if severity not in {"low", "medium", "high"}:
            severity = "medium"
        inspection_points = _normalize_text(
            item.get("inspection_points")
            or item.get("inspection_method")
            or item.get("check_method")
        )
        photo_requirements = _normalize_text(
            item.get("photo_requirements")
            or item.get("photo_requirement")
            or item.get("photo_points")
        )
        measure = _normalize_text(
            item.get("measure")
            or item.get("control_measure")
            or item.get("control_measures")
        )
        cleaned_items.append(
            {
                "risk_description": _normalize_text(item.get("risk_description"), "待确认质量控制点"),
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
        fallback_inspection = "核查施工部位、材料规格、样板做法、尺寸标高、隐蔽验收和质量资料是否满足设计及规范要求。"
        fallback_photo = "拍摄施工部位全景、材料标识、关键节点、实测数据、隐蔽验收和整改前后对比照片。"
        fallback_measure = "发现质量问题后暂停相关工序，按规范和设计要求返工或整改，复验合格并补齐资料后再进入下道工序。"
        cleaned_items = [
            {
                "risk_description": "现场质量控制信息不足，需要补充专项质量检查。",
                "inspection_points": fallback_inspection,
                "photo_requirements": fallback_photo,
                "measure": _build_combined_measure(fallback_inspection, fallback_photo, fallback_measure),
                "severity": "medium",
            }
        ]

    cleaned_items = _apply_process_templates(messages, parsed, cleaned_items)

    return {
        "type": "checklist",
        "summary": _normalize_text(parsed.get("summary"), "AI 生成质量控制任务"),
        "permits": [],
        "items": cleaned_items[:MAX_QUALITY_ITEMS],
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

    try:
        _used_provider, result = ai_config_service.request_chat_completion(
            db,
            messages=messages,
            provider_id=provider_id,
            temperature=0.1,
            max_tokens=3500,
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
            normalized = _normalize_question_payload(parsed, ai_content)

        content = json.dumps(normalized, ensure_ascii=False)
        messages.append({"role": "assistant", "content": content})
        return session_id, normalized["type"], content
    except Exception as exc:
        messages.pop()
        raise ValueError(f"AI 服务异常：{exc}") from exc


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
