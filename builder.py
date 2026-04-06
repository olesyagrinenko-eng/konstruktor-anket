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


def _asset_url_for_stimulus(assets: dict | None, stimulus_type: str, index: int) -> str | None:
    if not assets or not stimulus_type or index < 1:
        return None
    arr = assets.get(stimulus_type)
    if not isinstance(arr, list) or index > len(arr):
        return None
    item = arr[index - 1]
    if isinstance(item, dict):
        u = (item.get("url") or "").strip()
        return u or None
    if isinstance(item, str):
        u = item.strip()
        return u or None
    return None


def instantiate_template(
    tpl: dict,
    *,
    stimulus_type: str | None,
    stimulus_index: int | None,
    block_prefix: str,
    q_index: list,  # mutable counter [0]
    asset_url: str | None = None,
) -> dict:
    """Один экземпляр вопроса из шаблона."""
    q_index[0] += 1
    sid = _make_qid(block_prefix, q_index[0])
    text = tpl.get("text", "")
    if stimulus_type and stimulus_index is not None:
        label = STIMULUS_LABELS.get(stimulus_type, stimulus_type)
        text = f"[{label} #{stimulus_index}] {text}"

    q: dict[str, Any] = {
        "id": sid,
        "qtype": tpl.get("qtype", "open"),
        "text": text,
        "programmer_note": tpl.get("prog_note", ""),
        "options": tpl.get("options"),
        "anchors": tpl.get("anchors"),
        "stimulus": None,
    }
    if stimulus_type is not None and stimulus_index is not None:
        st: dict[str, Any] = {"type": stimulus_type, "index": stimulus_index}
        if asset_url:
            st["asset_url"] = asset_url
        q["stimulus"] = st
    return q


def expand_templates_for_repeat(
    tpl: dict,
    counts: dict[str, int],
    block_prefix: str,
    q_index: list,
    *,
    stimulus_assets: dict | None = None,
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
        au = _asset_url_for_stimulus(stimulus_assets, rp, i)
        out.append(
            instantiate_template(
                tpl,
                stimulus_type=rp,
                stimulus_index=i,
                block_prefix=block_prefix,
                q_index=q_index,
                asset_url=au,
            )
        )
    return out


def _resolve_group_templates(
    group: dict,
    active: set[str],
    counts: dict[str, int],
    template_selection: dict[str, list[str]] | None,
) -> list[dict]:
    """Учитывает выбор шаблонов и правило: при наличии роликов не показывать дебренд-открытый по макету."""
    base = collect_templates_for_group(group, active)
    if not base:
        return []
    gid = group["id"]
    sel = (template_selection or {}).get(gid)
    if sel is None:
        chosen = base
    elif not sel:
        if gid == "screening_base":
            chosen = base
        else:
            chosen = []
    else:
        sset = set(sel)
        chosen = [t for t in base if t.get("tid") in sset]
    if counts.get("video", 0) > 0:
        chosen = [t for t in chosen if not t.get("layout_debrand_open")]
    return chosen


def _resolve_extra_templates(
    extra: dict,
    active: set[str],
    extra_template_selection: dict[str, list[str]] | None,
) -> list[dict]:
    inj = extra.get("inject") or {}
    fs = set(inj.get("for_stimuli") or [])
    if fs and not (fs & active):
        return []
    base = list(inj.get("templates") or [])
    if not base:
        return []
    eid = extra["id"]
    sel = (extra_template_selection or {}).get(eid)
    if sel is None:
        return base
    if not sel:
        return []
    sset = set(sel)
    return [t for t in base if t.get("tid") in sset]


def _build_indicator_block(
    group: dict,
    *,
    phase: str,
    active: set[str],
    counts: dict[str, int],
    template_selection: dict[str, list[str]] | None,
    q_global: list,
    stimulus_assets: dict | None,
) -> dict | None:
    if not group_applies(group, phase, active):
        return None
    templates = _resolve_group_templates(group, active, counts, template_selection)
    if not templates:
        return None
    bp = f"q_{_slug(group['id'])}"
    block: dict[str, Any] = {
        "id": f"blk_{group['id']}",
        "title": group["label"],
        "programmer_instructions": group.get("description") or "",
        "questions": [],
    }
    for tpl in templates:
        block["questions"].extend(
            expand_templates_for_repeat(
                tpl, counts, bp, q_global, stimulus_assets=stimulus_assets
            )
        )
    if not block["questions"]:
        return None
    return block


def _build_extra_block(
    extra: dict,
    *,
    active: set[str],
    counts: dict[str, int],
    extra_template_selection: dict[str, list[str]] | None,
    q_global: list,
    stimulus_assets: dict | None,
) -> dict | None:
    templates = _resolve_extra_templates(extra, active, extra_template_selection)
    if not templates:
        return None
    bp = f"q_extra_{extra['id']}"
    block: dict[str, Any] = {
        "id": f"blk_extra_{extra['id']}",
        "title": f"Дополнительно: {extra['label']}",
        "programmer_instructions": extra.get("hint") or "",
        "questions": [],
    }
    for tpl in templates:
        block["questions"].extend(
            expand_templates_for_repeat(
                tpl, counts, bp, q_global, stimulus_assets=stimulus_assets
            )
        )
    if not block["questions"]:
        return None
    return block


def _rotation_and_same_questions_notes(counts: dict[str, int]) -> str:
    parts: list[str] = []
    for key, n in counts.items():
        if int(n or 0) <= 1:
            continue
        label = STIMULUS_LABELS.get(key, key)
        parts.append(
            f"{label}: в анкете {n} стимулов — задать ротацию порядка показа и/или балансировку по квотам "
            f"(каждый респондент видит все или подмножество — по ТЗ проекта и возможностям панели)."
        )
    rot = " ".join(parts) if parts else ""
    same = (
        "Одинаковые формулировки вопросов для разных макетов/роликов: для каждого номера стимула "
        "([Макет #k], [Ролик #k] и т.д.) повторяется один и тот же блок шкал и открытых вопросов; "
        "в базе завести отдельные переменные на каждый k или цикл по списку креативов — по правилам платформы."
    )
    if rot:
        return rot + " " + same
    return same


def build_questionnaire(payload: dict) -> dict[str, Any]:
    """
    payload:
      project_name, phase, counts, group_ids, extra_ids,
      template_selection: { group_id: [tid, ...] } — если ключа нет, берутся все шаблоны группы;
        пустой список (кроме screening_base) — группа не попадает в анкету.
      extra_template_selection: { extra_id: [tid, ...] } — аналогично для доп. блоков.
      stimulus_assets: { video|layout|...: [ {url, label?}, ... ] }
      custom_questions, client_notes
    """
    phase = payload.get("phase") or "pre"
    counts = {
        "video": max(0, int(payload.get("counts", {}).get("video") or 0)),
        "layout": max(0, int(payload.get("counts", {}).get("layout") or 0)),
        "scenario": max(0, int(payload.get("counts", {}).get("scenario") or 0)),
        "concept": max(0, int(payload.get("counts", {}).get("concept") or 0)),
        "packaging": max(0, int(payload.get("counts", {}).get("packaging") or 0)),
    }
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
    selected_groups.add("screening_base")
    extra_ids = set(payload.get("extra_ids") or [])

    template_selection_in = payload.get("template_selection") or {}
    template_selection: dict[str, list[str]] = {}
    for gid, tids in template_selection_in.items():
        if isinstance(tids, list):
            template_selection[str(gid)] = [str(x) for x in tids]

    extra_sel_in = payload.get("extra_template_selection") or {}
    extra_template_selection: dict[str, list[str]] = {}
    for eid, tids in extra_sel_in.items():
        if isinstance(tids, list):
            extra_template_selection[str(eid)] = [str(x) for x in tids]

    stimulus_assets = payload.get("stimulus_assets")
    if not isinstance(stimulus_assets, dict):
        stimulus_assets = {}

    blocks: list[dict] = []
    notes = (payload.get("client_notes") or "").strip()
    meta: dict[str, Any] = {
        "project_name": (payload.get("project_name") or "").strip() or "Без названия",
        "phase": phase,
        "phase_label": "Посттест (после кампании)" if phase == "post" else "Претест (до кампании)",
        "counts": counts,
        "active_stimuli": sorted(active),
        "client_notes": notes,
        "stimulus_assets": stimulus_assets,
    }

    base_intro = (
        "Собрать анкету в системе сбора (ОнИн и т.п.) согласно порядку блоков ниже. "
        "Для каждого вопроса — тип ответа, валидация, условия показа (если указаны), квоты — по отдельному ТЗ проекта. "
        "Названия бренда и списки городов подставить из брифа. "
        "Ссылки на медиа стимулов (если заданы в конструкторе) подставить в показ на соответствующих экранах."
    )
    dyn = _rotation_and_same_questions_notes(counts)
    prog_intro = {
        "id": "blk_intro",
        "title": "0. Вводные для разработки анкеты",
        "programmer_instructions": base_intro + " " + dyn,
        "questions": [],
    }
    blocks.append(prog_intro)

    q_global = [0]

    recall_extra = next((e for e in EXTRA_OPTIONS if e["id"] == "recall_seen_layouts"), None)
    recall_pending: dict | None = None
    if recall_extra and recall_extra["id"] in extra_ids:
        blk = _build_extra_block(
            recall_extra,
            active=active,
            counts=counts,
            extra_template_selection=extra_template_selection,
            q_global=q_global,
            stimulus_assets=stimulus_assets,
        )
        if blk:
            recall_pending = blk

    for group in INDICATOR_GROUPS:
        if group["id"] not in selected_groups:
            continue
        if group["id"] == "layout_core" and recall_pending:
            blocks.append(recall_pending)
            recall_pending = None

        blk = _build_indicator_block(
            group,
            phase=phase,
            active=active,
            counts=counts,
            template_selection=template_selection,
            q_global=q_global,
            stimulus_assets=stimulus_assets,
        )
        if blk:
            blocks.append(blk)

    if recall_pending:
        blocks.append(recall_pending)

    for extra in EXTRA_OPTIONS:
        if extra["id"] not in extra_ids:
            continue
        if extra["id"] == "recall_seen_layouts":
            continue
        blk = _build_extra_block(
            extra,
            active=active,
            counts=counts,
            extra_template_selection=extra_template_selection,
            q_global=q_global,
            stimulus_assets=stimulus_assets,
        )
        if blk:
            blocks.append(blk)

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
