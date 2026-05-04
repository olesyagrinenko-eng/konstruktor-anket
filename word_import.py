# -*- coding: utf-8 -*-
"""Импорт анкет из Word (.docx) во внутреннюю структуру конструктора."""
from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
QUESTION_START_RE = re.compile(r"^(?:Q\s*)?(\d+)\.\s*(.+)$", re.I)
CODE_ONLY_RE = re.compile(r"^Q[A-Za-z0-9_]{1,23}$")
OPTION_RE = re.compile(r"^(\d+)\)\s*(.+)$")
URL_RE = re.compile(r"https?://\S+", re.I)


def _child_tag(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def _read_docx_elements(blob: bytes) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    with ZipFile(BytesIO(blob)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    body = root.find("w:body", NS)
    if body is None:
        return out
    for child in body:
        tag = _child_tag(child)
        if tag == "p":
            texts = [t.text for t in child.findall(".//w:t", NS) if t.text]
            text = " ".join(" ".join(texts).split())
            if text:
                out.append(("p", text))
        elif tag == "tbl":
            rows: list[list[str]] = []
            for row in child.findall("w:tr", NS):
                vals: list[str] = []
                for cell in row.findall("w:tc", NS):
                    texts = [t.text for t in cell.findall(".//w:t", NS) if t.text]
                    vals.append(" ".join(" ".join(texts).split()))
                if any(vals):
                    rows.append(vals)
            if rows:
                out.append(("tbl", rows))
    return out


def _is_instruction_start(text: str) -> bool:
    low = text.lower()
    return low.startswith("экран ") or low.startswith("далее будет представлен") or "клик тест" in low


def _is_property_line(text: str) -> bool:
    low = text.lower()
    prefixes = (
        "текст:",
        "тип:",
        "варианты:",
        "перемешивать ответы:",
        "эксклюзивные:",
        "открытые варианты:",
        "заметка:",
        "minimum:",
        "maximum:",
        "минимум:",
        "максимум:",
        "левый якорь:",
        "правый якорь:",
        "mediaurl:",
        "stimulustype:",
        "stimulusindex:",
        "максимум точек:",
        "этап:",
        "название проекта:",
    )
    return low.startswith(prefixes)


def _parse_structured_item(item: dict[str, Any], serial: int) -> dict[str, Any]:
    code = item.get("code") or f"IMP{serial:03d}"
    props: dict[str, str] = {}
    options: list[str] = []
    notes: list[str] = []
    for line in item.get("lines") or []:
        if OPTION_RE.match(line):
            options.append(OPTION_RE.match(line).group(2).strip())  # type: ignore[union-attr]
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            props[key.strip().lower()] = value.strip()
        else:
            notes.append(line)

    qtype_raw = props.get("тип", "").lower()
    qtype = {
        "инструкция": "instruction",
        "открытый": "open",
        "число": "open_numeric",
        "один из списка": "single",
        "несколько из списка": "multi",
        "шкала": "scale_1_9" if str(props.get("максимум", "9")).strip() != "5" else "scale_1_5",
        "клик-тест": "click_map",
    }.get(qtype_raw, "instruction")
    payload: dict[str, Any] = {
        "id": code,
        "qtype": qtype,
        "text": props.get("текст") or item.get("title") or code,
        "programmer_note": "\n".join(
            [props.get("заметка", "").strip(), *[x for x in notes if x.strip()]]
        ).strip(),
        "options": options or None,
        "anchors": None,
        "stimulus": None,
    }
    if props.get("левый якорь") or props.get("правый якорь"):
        max_key = "5" if qtype == "scale_1_5" else "9"
        payload["anchors"] = {
            "1": props.get("левый якорь", ""),
            max_key: props.get("правый якорь", ""),
        }
    if props.get("минимум"):
        payload["min_value"] = int(props["минимум"])
    if props.get("максимум"):
        payload["max_value"] = int(props["максимум"])
    if (props.get("перемешивать ответы") or "").lower() in {"да", "true", "1"}:
        payload["is_randomize"] = True
    if props.get("эксклюзивные"):
        payload["is_exclusive"] = props["эксклюзивные"]
    if props.get("открытые варианты"):
        payload["other"] = props["открытые варианты"]
    if props.get("максимум точек"):
        payload["max_points"] = int(props["максимум точек"])
    media_url = props.get("mediaurl")
    stimulus_type = props.get("stimulustype")
    stimulus_index = props.get("stimulusindex")
    if media_url or stimulus_type or stimulus_index:
        payload["stimulus"] = {
            "type": stimulus_type or "layout",
            "index": int(stimulus_index or 1),
        }
        if media_url:
            payload["stimulus"]["asset_url"] = media_url
    return payload


def _infer_qtype(text: str, lines: list[str]) -> str:
    joined = "\n".join([text, *lines]).lower()
    if "клик тест" in joined:
        return "click_map"
    if "несколько из списка" in joined:
        return "multi"
    if "один из списка" in joined:
        return "single"
    if "открытый" in joined:
        return "open"
    if "шкала" in joined:
        max_m = re.search(r"максимум:\s*(\d+)", joined)
        if max_m and max_m.group(1) == "5":
            return "scale_1_5"
        return "scale_1_9"
    if "поле для ввода" in joined or "запишите число" in joined:
        return "open_numeric"
    return "instruction"


def _extract_options(lines: list[str]) -> list[str]:
    opts: list[str] = []
    for line in lines:
        m = OPTION_RE.match(line)
        if m:
            opts.append(m.group(2).strip())
    return opts


def _extract_scale(lines: list[str]) -> dict[str, Any]:
    anchors = None
    min_value = None
    max_value = None
    for line in lines:
        anchor_m = re.search(r"'([^']+)'\s*->\s*'([^']+)'", line)
        if anchor_m:
            anchors = {"1": anchor_m.group(1).strip(), "9": anchor_m.group(2).strip()}
        min_m = re.search(r"минимум:\s*(\d+)", line, re.I)
        if min_m:
            min_value = int(min_m.group(1))
        max_m = re.search(r"максимум:\s*(\d+)", line, re.I)
        if max_m:
            max_value = int(max_m.group(1))
    if anchors and max_value == 5:
        anchors = {"1": anchors["1"], "5": anchors["9"]}
    return {"anchors": anchors, "min_value": min_value, "max_value": max_value}


def _extract_url(text: str, lines: list[str]) -> str | None:
    joined = "\n".join([text, *lines])
    m = URL_RE.search(joined)
    return m.group(0) if m else None


def _extract_max_points(lines: list[str]) -> int | None:
    for line in lines:
        m = re.search(r"отметьте\s+(\d+)", line, re.I)
        if m:
            return int(m.group(1))
    return None


def _make_item(kind: str, title: str, number: str | None = None) -> dict[str, Any]:
    return {"kind": kind, "number": number, "title": title.strip(), "lines": []}


def _finalize_item(item: dict[str, Any], serial: int) -> dict[str, Any]:
    if item.get("kind") == "structured":
        return _parse_structured_item(item, serial)
    text = item["title"].strip()
    lines = [line.strip() for line in item.get("lines") or [] if line.strip()]
    qtype = _infer_qtype(text, lines) if item["kind"] != "instruction" else "instruction"
    scale = _extract_scale(lines)
    url = _extract_url(text, lines)
    options = _extract_options(lines)
    notes = [line for line in lines if not OPTION_RE.match(line)]
    question_id = f"Q{item['number']}" if item.get("number") else f"IMP{serial:03d}"
    payload: dict[str, Any] = {
        "id": question_id,
        "qtype": qtype,
        "text": text,
        "programmer_note": "\n".join(notes).strip(),
        "options": options or None,
        "anchors": scale["anchors"],
        "stimulus": None,
    }
    if qtype == "click_map":
        payload["max_points"] = _extract_max_points(lines) or 3
        if url:
            payload["stimulus"] = {"type": "layout", "index": 1, "asset_url": url}
    elif url:
        payload["stimulus"] = {"type": "layout", "index": 1, "asset_url": url}
    if scale["min_value"] is not None:
        payload["min_value"] = scale["min_value"]
    if scale["max_value"] is not None:
        payload["max_value"] = scale["max_value"]
    if any("перемешивать ответы" in line.lower() for line in lines):
        payload["is_randomize"] = True
    if options:
        for idx, opt in enumerate(options, start=1):
            low = opt.lower()
            if "другое" in low:
                payload["other"] = str(idx)
            if any(token in low for token in ("ни один", "ничего", "затрудняюсь", "отказ")):
                cur = payload.get("is_exclusive")
                payload["is_exclusive"] = f"{cur},{idx}" if cur else str(idx)
    return payload


def import_docx_to_spec(blob: bytes, filename: str) -> tuple[dict[str, Any], list[str]]:
    """Преобразовать Word-файл в редактируемый внутренний spec."""
    warnings: list[str] = []
    elements = _read_docx_elements(blob)

    project_name = Path(filename).stem
    blocks = [
        {
            "id": "blk_imported_word",
            "title": "Импорт из Word",
            "programmer_instructions": "Анкета импортирована из .docx; проверьте распознанные типы, шкалы, списки и служебные заметки перед экспортом в SSI JSON.",
            "questions": [],
        }
    ]

    current: dict[str, Any] | None = None
    serial = 0
    intro_notes: list[str] = []

    def push_current() -> None:
        nonlocal current, serial
        if not current:
            return
        serial += 1
        blocks[0]["questions"].append(_finalize_item(current, serial))
        current = None

    for kind, value in elements:
        if kind == "tbl":
            table_lines = [" | ".join(cell for cell in row if cell).strip() for row in value]
            table_text = "\n".join(line for line in table_lines if line)
            if current:
                current["lines"].append(table_text)
            else:
                intro_notes.append(table_text)
            continue

        text = str(value).strip()
        if not text:
            continue
        if current and current.get("kind") == "structured":
            if CODE_ONLY_RE.match(text):
                push_current()
                current = {"kind": "structured", "code": text.strip(), "title": text.strip(), "lines": []}
                continue
            current["lines"].append(text)
            continue
        if serial == 0 and not current and not QUESTION_START_RE.match(text):
            if CODE_ONLY_RE.match(text):
                current = {"kind": "structured", "code": text.strip(), "title": text.strip(), "lines": []}
                continue
            if not intro_notes:
                project_name = text
            else:
                intro_notes.append(text)
            continue

        if current and OPTION_RE.match(text):
            current["lines"].append(text)
            continue

        question_m = QUESTION_START_RE.match(text)
        if question_m:
            push_current()
            current = _make_item("question", question_m.group(2), question_m.group(1))
            continue

        if CODE_ONLY_RE.match(text):
            push_current()
            current = {"kind": "structured", "code": text.strip(), "title": text.strip(), "lines": []}
            continue

        if _is_instruction_start(text):
            push_current()
            current = _make_item("instruction", text)
            continue

        if current and _is_property_line(text):
            current["lines"].append(text)
            continue

        if current:
            current["lines"].append(text)
        else:
            intro_notes.append(text)

    push_current()

    if intro_notes:
        blocks.insert(
            0,
            {
                "id": "blk_import_intro",
                "title": "Вводные из Word",
                "programmer_instructions": "Неразмеченные вводные строки из исходного документа.",
                "questions": [
                    {
                        "id": "IMP000",
                        "qtype": "instruction",
                        "text": intro_notes[0],
                        "programmer_note": "\n".join(intro_notes[1:]).strip(),
                        "options": None,
                        "anchors": None,
                        "stimulus": None,
                    }
                ],
            },
        )

    if not blocks[-1]["questions"]:
        warnings.append("В Word не удалось распознать ни одного вопроса. Проверьте формат документа.")

    warnings.append(
        "Импорт из Word использует эвристики: обязательно проверьте типы вопросов, шкалы, эксклюзивные варианты и медиа-ссылки перед выгрузкой."
    )
    return {
        "meta": {
            "project_name": project_name,
            "phase": "pre",
            "phase_label": "Импорт из Word",
            "counts": {},
            "active_stimuli": [],
            "client_notes": "",
            "source_filename": filename,
        },
        "blocks": blocks,
    }, warnings
