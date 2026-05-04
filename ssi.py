# -*- coding: utf-8 -*-
"""Преобразование внутренней спецификации конструктора в SSI JSON."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except Exception:  # noqa: BLE001
    Draft202012Validator = None


SCHEMA_PATH = Path(__file__).resolve().parent / "docs" / "contractor-ssi-questionnaire.schema.json"
QUESTION_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,23}$")
URL_RE = re.compile(r"https?://\S+", re.I)

DEFAULT_SCALE_ANCHORS = {
    "scale_1_9": ("Совсем не нравится", "Очень нравится"),
    "scale_1_5": ("Совсем не нравится", "Очень нравится"),
}


@lru_cache(maxsize=1)
def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _safe_question_name(raw: str | None, index: int, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "", str(raw or ""))
    if not base or not base[0].isalpha():
        base = f"Q{index}"
    base = base[:24]
    if not QUESTION_NAME_RE.match(base):
        base = f"Q{index}"
    name = base
    suffix = 2
    while name in used:
        tail = str(suffix)
        name = f"{base[: max(1, 24 - len(tail))]}{tail}"
        suffix += 1
    used.add(name)
    return name


def _as_list_numbers(size: int) -> list[str]:
    return [str(i) for i in range(1, size + 1)]


def _parse_anchor_bounds(qtype: str, anchors: dict[str, str] | None) -> tuple[str, str, int]:
    if anchors:
        ordered = sorted(((int(k), v) for k, v in anchors.items()), key=lambda item: item[0])
        if ordered:
            return ordered[0][1], ordered[-1][1], ordered[-1][0]
    left, right = DEFAULT_SCALE_ANCHORS.get(qtype, DEFAULT_SCALE_ANCHORS["scale_1_9"])
    return left, right, 9 if qtype == "scale_1_9" else 5


def _guess_stimulus_type(text: str) -> str | None:
    low = text.lower()
    if any(token in low for token in ("ролик", "видео", "раскадров")):
        return "video"
    if any(token in low for token in ("сценари", "сториборд")):
        return "scenario"
    if "упаков" in low:
        return "packaging"
    if "концеп" in low:
        return "concept"
    if any(token in low for token in ("макет", "плакат", "баннер")):
        return "layout"
    return None


def _extract_url(*parts: str | None) -> str | None:
    for part in parts:
        if not part:
            continue
        m = URL_RE.search(part)
        if m:
            return m.group(0)
    return None


def spec_to_ssi(spec: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Преобразовать внутренний spec в массив вопросов SSI."""
    warnings: list[str] = []
    used_names: set[str] = set()
    out: list[dict[str, Any]] = []
    question_index = 0

    for block in spec.get("blocks") or []:
        for q in block.get("questions") or []:
            question_index += 1
            qtype = q.get("qtype") or "open"
            name = _safe_question_name(q.get("id"), question_index, used_names)
            header = (q.get("text") or "").strip() or f"Вопрос {question_index}"
            note = (q.get("programmer_note") or "").strip() or None
            item: dict[str, Any] = {
                "name": name,
                "type": "OPEN-END",
                "selectFormat": None,
                "header2": header,
            }
            if note:
                item["question"] = note

            options = [str(x).strip() for x in (q.get("options") or []) if str(x).strip()]
            stimulus = q.get("stimulus") or {}
            stim_type = stimulus.get("type") or _guess_stimulus_type(f"{header}\n{note or ''}")
            stim_index = stimulus.get("index")
            media_url = stimulus.get("asset_url") or _extract_url(header, note)

            if qtype == "instruction":
                item["type"] = "TEXT"
            elif qtype == "open":
                item["type"] = "OPEN-END"
            elif qtype == "open_numeric":
                item["type"] = "NUMERIC"
                min_value = q.get("min_value")
                max_value = q.get("max_value")
                if min_value is not None:
                    item["minValue"] = min_value
                if max_value is not None:
                    item["maxValue"] = max_value
            elif qtype in {"single", "multi", "multi_placeholder"}:
                item["type"] = "SELECT"
                item["selectFormat"] = "1" if qtype == "single" else "2"
                item["list"] = options or ["[Заполнить варианты]"]
                if q.get("is_randomize"):
                    item["isRandomize"] = True
                if q.get("is_exclusive"):
                    item["isExclusive"] = q["is_exclusive"]
                if q.get("other"):
                    item["other"] = q["other"]
            elif qtype in {"scale_1_9", "scale_1_5"}:
                left, right, max_code = _parse_anchor_bounds(qtype, q.get("anchors"))
                item["type"] = "SELECT"
                item["selectFormat"] = "1"
                item["list"] = _as_list_numbers(max_code)
                item["meta"] = {
                    "widgetType": "scale",
                    "minScaleAnchor": left,
                    "maxScaleAnchor": right,
                }
            elif qtype == "click_map":
                item["type"] = "GRID"
                item["selectFormat"] = "1"
                meta: dict[str, Any] = {
                    "widgetType": "click_coord",
                    "maxPoints": int(q.get("max_points") or 3),
                }
                if media_url:
                    meta["mediaUrl"] = media_url
                if stim_type:
                    meta["stimulusType"] = stim_type
                if stim_index:
                    meta["stimulusIndex"] = int(stim_index)
                else:
                    meta["stimulusIndex"] = 1
                item["meta"] = meta
                item["list_column"] = [""]
                if not media_url:
                    warnings.append(
                        f"{name}: для click_coord не найден mediaUrl, JSON не пройдет валидацию, пока ссылка не будет задана."
                    )
            else:
                warnings.append(f"{name}: неизвестный тип {qtype}, использован OPEN-END.")

            if stim_type and item.get("meta", {}).get("widgetType") != "click_coord":
                meta = dict(item.get("meta") or {})
                if media_url:
                    meta["mediaUrl"] = media_url
                if media_url or stim_index:
                    meta["stimulusType"] = stim_type
                    meta["stimulusIndex"] = int(stim_index or 1)
                if meta:
                    item["meta"] = meta

            out.append(item)

    return out, warnings


def validate_ssi_questionnaire(questionnaire: list[dict[str, Any]]) -> dict[str, Any]:
    """Проверить массив вопросов по JSON Schema."""
    if Draft202012Validator is None:
        return {
            "ok": False,
            "errors": [
                {
                    "path": "$",
                    "message": "Пакет jsonschema не установлен в окружении, поэтому схема не была проверена."
                }
            ],
        }

    validator = Draft202012Validator(load_schema())
    errors = sorted(validator.iter_errors(questionnaire), key=lambda err: list(err.path))
    return {
        "ok": not errors,
        "errors": [
            {
                "path": "$" + "".join(
                    f"[{part}]" if isinstance(part, int) else f".{part}" for part in err.path
                ),
                "message": err.message,
            }
            for err in errors
        ],
    }
