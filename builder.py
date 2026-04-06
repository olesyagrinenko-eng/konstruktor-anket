# -*- coding: utf-8 -*-
"""Сборка структуры анкеты из выбора заказчика."""
from __future__ import annotations

import re
import uuid
from typing import Any

from catalog import (
    EXTRA_OPTIONS,
    INDICATOR_GROUPS,
    STIMULUS_LABELS,
    collect_templates_for_group,
    group_applies,
)


def _slug(s: str) -> str:
    s = re.sub(r"\s+", "_", s.strip().lower())
    s = re.sub(r"[^a-z0-9_а-яё]+", "", s, flags=re.I)
    return s[:40] or "block"


def _make_qid(prefix: str, idx: int) -> str:
    return f"{prefix}_{idx:03d}"


def instantiate_template(
    tpl: dict,
    *,
    stimulus_type: str | None,
    stimulus_index: int | None,
    block_prefix: str,
    q_index: list,  # mutable counter [0]
) -> dict:
    """Один экземпляр вопроса из шаблона."""
    q_index[0] += 1
    sid = _make_qid(block_prefix, q_index[0])
    text = tpl.get("text", "")
    if stimulus_type and stimulus_index is not None:
        label = STIMULUS_LABELS.get(stimulus_type, stimulus_type)
        text = f"[{label} #{stimulus_index}] {text}"

    q = {
        "id": sid,
        "qtype": tpl.get("qtype", "open"),
        "text": text,
        "programmer_note": tpl.get("prog_note", ""),
        "options": tpl.get("options"),
        "anchors": tpl.get("anchors"),
        "stimulus": None,
    }
    if stimulus_type is not None and stimulus_index is not None:
        q["stimulus"] = {"type": stimulus_type, "index": stimulus_index}
    return q


def expand_templates_for_repeat(
    tpl: dict,
    counts: dict[str, int],
    block_prefix: str,
    q_index: list,
) -> list[dict]:
    """Размножить шаблон по числу стимулов нужного типа."""
    rp = tpl.get("repeat_per")
    out: list[dict] = []
    if not rp:
        out.append(
            instantiate_template(
                tpl,
                stimulus_type=None,
                stimulus_index=None,
                block_prefix=block_prefix,
                q_index=q_index,
            )
        )
        return out
    n = counts.get(rp, 0)
    for i in range(1, n + 1):
        out.append(
            instantiate_template(
                tpl,
                stimulus_type=rp,
                stimulus_index=i,
                block_prefix=block_prefix,
                q_index=q_index,
            )
        )
    return out


def build_questionnaire(payload: dict) -> dict[str, Any]:
    """
    payload:
      project_name: str
      phase: 'pre' | 'post'
      has_separate_scenario: bool  # сценарий как отдельный носитель (не только внутри концепции)
      has_concept_package: bool   # концепция = несколько носителей
      counts: { video, layout, scenario, concept, packaging } int
      group_ids: list[str]  # выбранные группы показателей
      extra_ids: list[str]
      custom_blocks: optional list of extra questions from UI
    """
    phase = payload.get("phase") or "pre"
    counts = {
        "video": max(0, int(payload.get("counts", {}).get("video") or 0)),
        "layout": max(0, int(payload.get("counts", {}).get("layout") or 0)),
        "scenario": max(0, int(payload.get("counts", {}).get("scenario") or 0)),
        "concept": max(0, int(payload.get("counts", {}).get("concept") or 0)),
        "packaging": max(0, int(payload.get("counts", {}).get("packaging") or 0)),
    }
    # Активные типы стимулов для фильтрации групп (только по количеству материалов)
    active: set[str] = set()
    if counts["video"] > 0:
        active.add("video")
    if counts["layout"] > 0:
        active.add("layout")
    if counts["scenario"] > 0:
        active.add("scenario")
    if counts["concept"] > 0:
        active.add("concept")
    if counts["packaging"] > 0:
        active.add("packaging")

    raw_groups = payload.get("group_ids")
    if raw_groups:
        selected_groups = set(raw_groups)
    else:
        selected_groups = set(list_default_groups(payload))
    selected_groups.add("screening_base")  # скрининг обязателен
    extra_ids = set(payload.get("extra_ids") or [])

    blocks: list[dict] = []
    notes = (payload.get("client_notes") or "").strip()
    meta = {
        "project_name": (payload.get("project_name") or "").strip() or "Без названия",
        "phase": phase,
        "phase_label": "Посттест (после кампании)" if phase == "post" else "Претест (до кампании)",
        "counts": counts,
        "active_stimuli": sorted(active),
        "client_notes": notes,
    }

    # --- Блок: вводные для программиста ---
    prog_intro = {
        "id": "blk_intro",
        "title": "0. Вводные для разработки анкеты",
        "programmer_instructions": (
            "Собрать анкету в системе сбора (ОнИн и т.п.) согласно порядку блоков ниже. "
            "Для каждого вопроса — тип ответа, валидация, условия показа (если указаны), ротация стимулов и квоты — по отдельному ТЗ проекта. "
            "Названия бренда и списки городов подставить из брифа."
        ),
        "questions": [],
    }
    blocks.append(prog_intro)

    q_global = [0]

    # --- Индикаторы из каталога ---
    for group in INDICATOR_GROUPS:
        if group["id"] not in selected_groups:
            continue
        if not group_applies(group, phase, active):
            continue
        templates = collect_templates_for_group(group, active)
        if not templates:
            continue
        bp = f"q_{_slug(group['id'])}"
        block = {
            "id": f"blk_{group['id']}",
            "title": group["label"],
            "programmer_instructions": group.get("description") or "",
            "questions": [],
        }
        for tpl in templates:
            block["questions"].extend(
                expand_templates_for_repeat(tpl, counts, bp, q_global)
            )
        if block["questions"]:
            blocks.append(block)

    # --- Доп. опции (extras) ---
    for extra in EXTRA_OPTIONS:
        if extra["id"] not in extra_ids:
            continue
        inj = extra.get("inject") or {}
        fs = set(inj.get("for_stimuli") or [])
        if fs and not (fs & active):
            continue
        bp = f"q_extra_{extra['id']}"
        block = {
            "id": f"blk_extra_{extra['id']}",
            "title": f"Дополнительно: {extra['label']}",
            "programmer_instructions": extra.get("hint") or "",
            "questions": [],
        }
        for tpl in inj.get("templates") or []:
            block["questions"].extend(
                expand_templates_for_repeat(tpl, counts, bp, q_global)
            )
        if block["questions"]:
            blocks.append(block)

    # --- Пользовательские вопросы ---
    customs = payload.get("custom_questions") or []
    if customs:
        cb = {
            "id": "blk_custom",
            "title": "Пользовательские вопросы",
            "programmer_instructions": "Добавлены заказчиком в конструкторе; проверить согласованность нумерации с основной анкетой.",
            "questions": [],
        }
        for i, cq in enumerate(customs, start=1):
            if not isinstance(cq, dict):
                continue
            text = (cq.get("text") or "").strip()
            if not text:
                continue
            cb["questions"].append(
                {
                    "id": cq.get("id") or f"custom_{i:03d}_{uuid.uuid4().hex[:6]}",
                    "qtype": cq.get("qtype") or "open",
                    "text": text,
                    "programmer_note": (cq.get("programmer_note") or "").strip(),
                    "options": cq.get("options"),
                    "anchors": cq.get("anchors"),
                    "stimulus": None,
                }
            )
        if cb["questions"]:
            blocks.append(cb)

    return {"meta": meta, "blocks": blocks}


def list_default_groups(payload: dict) -> list[str]:
    """Какие group_ids включить по умолчанию для данных counts/phase."""
    phase = payload.get("phase") or "pre"
    counts = payload.get("counts") or {}
    active: set[str] = set()
    if int(counts.get("video") or 0) > 0:
        active.add("video")
    if int(counts.get("layout") or 0) > 0:
        active.add("layout")
    if int(counts.get("scenario") or 0) > 0:
        active.add("scenario")
    if int(counts.get("concept") or 0) > 0:
        active.add("concept")
    if int(counts.get("packaging") or 0) > 0:
        active.add("packaging")

    out = []
    for group in INDICATOR_GROUPS:
        if not group_applies(group, phase, active):
            continue
        if not collect_templates_for_group(group, active):
            continue
        if group.get("default_on"):
            out.append(group["id"])
    return out
