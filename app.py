# -*- coding: utf-8 -*-
"""Веб-сервис: конструктор анкет для тестов креативов."""
from __future__ import annotations

import io
import re
from datetime import datetime

from flask import Flask, jsonify, render_template, request, send_file

from builder import build_questionnaire, list_default_groups
from catalog import EXTRA_OPTIONS, INDICATOR_GROUPS, STIMULUS_LABELS
from docx_export import spec_to_docx

app = Flask(__name__)


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w\s\-А-Яа-яёЁ]+", "", name, flags=re.U).strip() or "anketa"
    base = re.sub(r"\s+", "_", base)[:80]
    return f"{base}_{datetime.now().strftime('%Y%m%d_%H%M')}.docx"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/catalog")
def api_catalog():
    groups_out = []
    for g in INDICATOR_GROUPS:
        groups_out.append(
            {
                "id": g["id"],
                "label": g["label"],
                "description": g.get("description") or "",
                "for_stimuli": g.get("for_stimuli") or [],
                "phase": g.get("phase") or "both",
                "default_on": bool(g.get("default_on")),
            }
        )
    extras_out = [
        {
            "id": e["id"],
            "label": e["label"],
            "hint": e.get("hint") or "",
            "for_stimuli": (e.get("inject") or {}).get("for_stimuli") or [],
        }
        for e in EXTRA_OPTIONS
    ]
    return jsonify(
        {
            "stimulus_labels": STIMULUS_LABELS,
            "indicator_groups": groups_out,
            "extra_options": extras_out,
        }
    )


@app.route("/api/suggest-groups", methods=["POST"])
def api_suggest_groups():
    data = request.get_json(force=True, silent=True) or {}
    gids = list_default_groups(data)
    return jsonify({"group_ids": gids})


@app.route("/api/build", methods=["POST"])
def api_build():
    data = request.get_json(force=True, silent=True) or {}
    spec = build_questionnaire(data)
    return jsonify(spec)


@app.route("/api/export/docx", methods=["POST"])
def api_export_docx():
    data = request.get_json(force=True, silent=True) or {}
    if not data.get("blocks"):
        return jsonify({"error": "Нет данных анкеты (blocks)"}), 400
    try:
        blob = spec_to_docx(data)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500
    name = _safe_filename(str(data.get("meta", {}).get("project_name") or "anketa"))
    return send_file(
        io.BytesIO(blob),
        as_attachment=True,
        download_name=name,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", "5050"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=port, debug=debug)
