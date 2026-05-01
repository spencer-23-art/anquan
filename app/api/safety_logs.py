from copy import deepcopy
from datetime import date, datetime, time
from pathlib import Path

import httpx
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt
from docx.table import Table
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db
from app.api.files import get_file_user
from app.config import settings
from app.models.task import Task
from app.models.user import User
from app.models.work_permit import WorkPermit

router = APIRouter(prefix="/api/safety-logs", tags=["safety-logs"])

TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "mobile" / "施工安全日志模板.docx"
WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
PERMIT_LABELS = {
    "hot_work_level1": "一级动火作业票",
    "hot_work_level2": "二级动火作业票",
    "hot_work_level3": "普通动火作业票",
    "height_level1": "一级高处作业票",
    "height_level2": "二级高处作业票",
    "height_level3": "三级高处作业票",
    "height_special": "特级高处作业票",
    "confined_space": "受限空间作业票",
    "lifting": "吊装作业票",
    "excavation": "动土作业票",
    "electrical": "临时用电作业票",
    "other": "其他作业票",
}


def day_bounds(log_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(log_date, time.min)
    end = datetime.combine(log_date, time.max)
    return start, end


def text_value(value: object, fallback: str = "-") -> str:
    text = str(value or "").strip()
    return text or fallback


async def fetch_weather() -> str:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("https://wttr.in/Chengdu?format=j1&lang=zh")
            response.raise_for_status()
            data = response.json()
        current = (data.get("current_condition") or [{}])[0]
        desc = (current.get("lang_zh") or current.get("weatherDesc") or [{}])[0].get("value")
        temp = current.get("temp_C")
        return f"{desc or '多云'} {temp}℃" if temp else desc or "多云"
    except Exception:
        return "多云"


def upload_path(upload_url: str | None) -> Path | None:
    if not upload_url:
        return None
    relative = str(upload_url).replace("\\", "/").removeprefix("/uploads/").removeprefix("uploads/")
    path = (Path(settings.UPLOAD_DIR) / relative).resolve()
    uploads_root = Path(settings.UPLOAD_DIR).resolve()
    if uploads_root not in path.parents and path != uploads_root:
        return None
    return path if path.exists() and path.is_file() else None


def add_cell_text(cell, text: str, *, bold: bool = False, size: int = 10) -> None:
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)


def add_photo(cell, upload_url: str | None, width_cm: float = 4.2) -> None:
    image_path = upload_path(upload_url)
    if not image_path:
        return
    paragraph = cell.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    try:
        run.add_picture(str(image_path), width=Cm(width_cm))
    except Exception:
        paragraph.add_run("[照片无法插入]")


def permit_value(permit: WorkPermit) -> str:
    return str(getattr(permit.type, "value", permit.type))


def permit_label(permit: WorkPermit) -> str:
    value = permit_value(permit)
    return PERMIT_LABELS.get(value, value)


def replace_text(paragraph, values: dict[str, str]) -> None:
    for run in paragraph.runs:
        text = run.text
        for key, value in values.items():
            for placeholder in (f"{{{{{key}}}}}", f"{{{key}}}", f"${{{key}}}"):
                text = text.replace(placeholder, value)
        run.text = text


def normalize_label(text: str) -> str:
    return "".join(text.replace("：", "").replace(":", "").split())


def fill_template_fields(document: Document, values: dict[str, str]) -> None:
    for paragraph in document.paragraphs:
        replace_text(paragraph, values)

    for table in document.tables:
        for row in table.rows:
            cells = row.cells
            for cell in cells:
                for paragraph in cell.paragraphs:
                    replace_text(paragraph, values)

            for index, cell in enumerate(cells[:-1]):
                label = normalize_label(cell.text)
                if label in values:
                    add_cell_text(cells[index + 1], values[label])


def append_template_table(document: Document, table_xml) -> Table:
    document.add_page_break()
    new_table_xml = deepcopy(table_xml)
    document._body._element.append(new_table_xml)
    return Table(new_table_xml, document._body)


def fill_template_table(table: Table, *, values: dict[str, str], permits, page_items) -> None:
    if len(table.rows) < 9:
        fill_template_fields(table._parent, values)
        return

    add_cell_text(table.rows[0].cells[1], values["施工单位"])
    add_cell_text(table.rows[0].cells[3], values["项目名称"])
    add_cell_text(table.rows[1].cells[1], values["日期"])
    add_cell_text(table.rows[1].cells[3], values["星期"])
    add_cell_text(table.rows[2].cells[1], values["天气"])
    add_cell_text(table.rows[2].cells[3], values["安全员"])

    permit_cell = table.rows[4].cells[0]
    permit_cell.text = ""
    if permits:
        for index, permit in enumerate(permits, start=1):
            paragraph = permit_cell.add_paragraph()
            run = paragraph.add_run(
                f"{index}. {permit_label(permit)}  区域：{permit.area.name if permit.area else '-'}  责任人：{permit.responsible_person}"
            )
            run.font.size = Pt(9)
            add_photo(permit_cell, permit.photo_url, width_cm=3.2)

    risk_rows = [table.rows[row_index].cells[0] for row_index in range(6, 9)]
    for cell in risk_rows:
        cell.text = ""

    if not page_items:
        add_cell_text(risk_rows[0], "当日暂无隐患排查记录。")
        return

    for cell, (index, task, item) in zip(risk_rows, page_items):
        add_cell_text(
            cell,
            "\n".join(
                [
                    f"隐患 {index}",
                    f"区域：{task.area.name if task.area else '-'}",
                    f"任务：{task.title}",
                    f"风险描述：{text_value(item.risk_description)}",
                    f"排查要点：{text_value(item.inspection_points)}",
                    f"整改要求：{text_value(item.measure)}",
                    f"排查时间：{item.checked_at.strftime('%Y-%m-%d %H:%M') if item.checked_at else '-'}",
                    f"备注：{text_value(item.note)}",
                ]
            ),
            size=9,
        )
        add_photo(cell, item.photo_url, width_cm=8.2)


def collect_log_data(db: Session, current_user: User, log_date: date):
    start, end = day_bounds(log_date)
    tasks = (
        db.query(Task)
        .options(joinedload(Task.area), joinedload(Task.assignee), joinedload(Task.checklist_items))
        .filter(Task.assignee_id == current_user.id)
        .filter((Task.created_at <= end) & ((Task.completed_at.is_(None)) | (Task.completed_at >= start)))
        .order_by(Task.created_at.desc())
        .all()
    )

    items = []
    for task in tasks:
        for item in task.checklist_items or []:
            in_checked_day = item.checked_at and start <= item.checked_at <= end
            in_task_day = task.created_at and start <= task.created_at <= end
            if in_checked_day or in_task_day:
                items.append((task, item))

    permits = (
        db.query(WorkPermit)
        .options(joinedload(WorkPermit.area), joinedload(WorkPermit.applicant))
        .filter(WorkPermit.applicant_id == current_user.id)
        .filter(WorkPermit.photo_url.isnot(None))
        .filter(WorkPermit.created_at >= start, WorkPermit.created_at <= end)
        .order_by(WorkPermit.created_at.desc())
        .all()
    )
    return tasks, items, permits


def build_docx(
    *,
    output_path: Path,
    log_date: date,
    weather: str,
    current_user: User,
    tasks,
    items,
    permits,
) -> None:
    inspector_name = current_user.real_name or current_user.username
    info_values = {
        "施工单位": "四川华庭",
        "项目名称": "风险区域",
        "巡查日期": log_date.strftime("%Y年%m月%d日"),
        "日期": log_date.strftime("%Y年%m月%d日"),
        "星期": WEEKDAY_LABELS[log_date.weekday()],
        "天气": weather,
        "安全员": inspector_name,
        "任务执行人": inspector_name,
        "作业票据": "、".join(permit_label(permit) for permit in permits) or "无",
        "隐患数量": str(len(items)),
    }

    using_template = TEMPLATE_PATH.exists()
    document = Document(str(TEMPLATE_PATH)) if using_template else Document()
    section = document.sections[0]
    section.orientation = WD_ORIENT.PORTRAIT
    section.top_margin = Cm(1.4)
    section.bottom_margin = Cm(1.4)
    section.left_margin = Cm(1.4)
    section.right_margin = Cm(1.4)

    if using_template:
        template_table_xml = deepcopy(document.tables[0]._tbl) if document.tables else None
        indexed_items = [(index, task, item) for index, (task, item) in enumerate(items, start=1)]
        pages = [indexed_items[index : index + 3] for index in range(0, len(indexed_items), 3)] or [[]]
        for page_index, page_items in enumerate(pages):
            if page_index == 0:
                table = document.tables[0]
            elif template_table_xml is not None:
                table = append_template_table(document, template_table_xml)
            else:
                table = document.add_table(rows=9, cols=4)
                table.style = "Table Grid"
            fill_template_fields(document, info_values)
            fill_template_table(
                table,
                values=info_values,
                permits=permits if page_index == 0 else [],
                page_items=page_items,
            )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        document.save(output_path)
        return
    else:
        title = document.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title.add_run("施工安全日志")
        run.bold = True
        run.font.size = Pt(18)

        info = document.add_table(rows=4, cols=4)
        info.style = "Table Grid"
        info_data = [
            ("施工单位", info_values["施工单位"], "项目名称", info_values["项目名称"]),
            ("巡查日期", info_values["巡查日期"], "星期", info_values["星期"]),
            ("天气", info_values["天气"], "安全员", info_values["安全员"]),
            ("作业票据", info_values["作业票据"], "隐患数量", info_values["隐患数量"]),
        ]
        for row, row_values in zip(info.rows, info_data):
            for cell, value in zip(row.cells, row_values):
                add_cell_text(cell, value, bold=value in {"施工单位", "项目名称", "巡查日期", "星期", "天气", "安全员", "作业票据", "隐患数量"})

    if permits:
        document.add_paragraph("")
        heading = document.add_paragraph()
        heading.add_run("作业许可照片").bold = True
        permit_table = document.add_table(rows=0, cols=2)
        permit_table.style = "Table Grid"
        for permit in permits:
            row = permit_table.add_row()
            add_cell_text(
                row.cells[0],
                f"{permit_label(permit)}\n区域：{permit.area.name if permit.area else '-'}\n责任人：{permit.responsible_person}",
                bold=False,
            )
            add_photo(row.cells[1], permit.photo_url)

    document.add_paragraph("")
    hidden_heading = document.add_paragraph()
    hidden_heading.add_run("隐患排查记录").bold = True

    if not items:
        document.add_paragraph("当日暂无隐患排查记录。")
    else:
        for index, (task, item) in enumerate(items, start=1):
            if index > 1 and (index - 1) % 4 == 0:
                document.add_page_break()
            table = document.add_table(rows=1, cols=1)
            table.style = "Table Grid"
            cell = table.rows[0].cells[0]
            add_cell_text(
                cell,
                "\n".join(
                    [
                        f"隐患 {index}",
                        f"区域：{task.area.name if task.area else '-'}",
                        f"任务：{task.title}",
                        f"风险描述：{text_value(item.risk_description)}",
                        f"排查要点：{text_value(item.inspection_points)}",
                        f"整改要求：{text_value(item.measure)}",
                        f"排查时间：{item.checked_at.strftime('%Y-%m-%d %H:%M') if item.checked_at else '-'}",
                    ]
                ),
                size=10,
            )
            add_photo(cell, item.photo_url, width_cm=9.0)
            document.add_paragraph("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)


@router.get("/generate")
async def generate_safety_log(
    log_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_file_user),
):
    log_date = log_date or date.today()
    tasks, items, permits = collect_log_data(db, current_user, log_date)
    weather = await fetch_weather()
    filename = f"safety-log-{current_user.id}-{log_date.isoformat()}.docx"
    output_path = Path(settings.UPLOAD_DIR) / "safety_logs" / filename
    build_docx(
        output_path=output_path,
        log_date=log_date,
        weather=weather,
        current_user=current_user,
        tasks=tasks,
        items=items,
        permits=permits,
    )
    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"施工安全日志-{log_date.isoformat()}.docx",
    )
