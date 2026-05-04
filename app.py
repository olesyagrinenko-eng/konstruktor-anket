# -*- coding: utf-8 -*-
"""Веб-сервис: конструктор анкет для тестов креативов."""
from __future__ import annotations

import io
import json
import os
import pathlib
import re
import uuid
from datetime import datetime

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from builder import build_questionnaire, list_default_groups
from catalog import EXTRA_OPTIONS, INDICATOR_GROUPS, STIMULUS_LABELS
from docx_export import spec_to_docx
from ssi import spec_to_ssi, validate_ssi_questionnaire
from word_import import import_docx_to_spec

app = Flask(__name__)

ALLOWED_UPLOAD_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}


def get_asset_version() -> str:
    """Версия для query-string у статики: коммит на Render/Heroku или mtime файлов (обновляется при правках без деплоя)."""
    for key in (
        "RENDER_GIT_COMMIT",
        "GIT_COMMIT",
        "SOURCE_VERSION",
        "KONSTRUKTOR_ASSET_VERSION",
    ):
        v = os.environ.get(key)
        if v:
            return re.sub(r"[^a-zA-Z0-9_.-]", "", str(v))[:24]
    root = pathlib.Path(__file__).resolve().parent
    files = [root / "static" / "app.js", root / "static" / "style.css"]
    try:
        return str(int(max(p.stat().st_mtime for p in files if p.is_file())))
    except (OSError, ValueError):
        return "1"


@app.context_processor
def _inject_asset_version():
    return {"asset_version": get_asset_version()}


@app.after_request
def _disable_caching_for_app(response):
    """Не кэшировать HTML, API и статику конструктора — иначе после выкладки висит старый JS и «старая анкета»."""
    path = request.path or ""
    if path == "/" or path.startswith("/api/") or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def _uploads_dir() -> str:
    return os.path.join(app.root_path, "static", "uploads")


def _ensure_uploads() -> None:
    path = _uploads_dir()
    os.makedirs(path, exist_ok=True)


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w\s\-А-Яа-яёЁ]+", "", name, flags=re.U).strip() or "anketa"
    base = re.sub(r"\s+", "_", base)[:80]
    return f"{base}_{datetime.now().strftime('%Y%m%d_%H%M')}.docx"


def _safe_json_filename(name: str) -> str:
    base = re.sub(r"[^\w\s\-А-Яа-яёЁ]+", "", name, flags=re.U).strip() or "questionnaire"
    base = re.sub(r"\s+", "_", base)[:80]
    return f"{base}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"


def _absolutize_url(url: str | None) -> str | None:
    if not url:
        return url
    if re.match(r"^https?://", url, flags=re.I):
        return url
    if url.startswith("/"):
        return f"{request.url_root.rstrip('/')}{url}"
    return url


def _normalize_spec_urls(spec: dict) -> dict:
    """Сделать ссылки на медиа абсолютными для SSI JSON."""
    meta = spec.get("meta") or {}
    assets = meta.get("stimulus_assets")
    if isinstance(assets, dict):
        for rows in assets.values():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict) and row.get("url"):
                    row["url"] = _absolutize_url(row.get("url"))

    for block in spec.get("blocks") or []:
        for question in block.get("questions") or []:
            stimulus = question.get("stimulus")
            if isinstance(stimulus, dict) and stimulus.get("asset_url"):
                stimulus["asset_url"] = _absolutize_url(stimulus.get("asset_url"))
    return spec


def _ssi_payload_from_spec(spec: dict) -> dict:
    questionnaire, warnings = spec_to_ssi(_normalize_spec_urls(spec))
    validation = validate_ssi_questionnaire(questionnaire)
    return {
        "questionnaire": questionnaire,
        "warnings": warnings,
        "validation": validation,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/preview")
def preview():
    return render_template("preview.html")


def _template_preview(t: dict) -> dict:
    return {
        "tid": t.get("tid"),
        "text": t.get("text") or "",
        "qtype": t.get("qtype"),
        "repeat_per": t.get("repeat_per"),
        "layout_debrand_open": bool(t.get("layout_debrand_open")),
    }


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
                "templates": [_template_preview(t) for t in (g.get("templates") or [])],
            }
        )
    extras_out = []
    for e in EXTRA_OPTIONS:
        inj = e.get("inject") or {}
        extras_out.append(
            {
                "id": e["id"],
                "label": e["label"],
                "hint": e.get("hint") or "",
                "for_stimuli": inj.get("for_stimuli") or [],
                "templates": [_template_preview(t) for t in (inj.get("templates") or [])],
            }
        )
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


@app.route("/api/upload-stimulus", methods=["POST"])
def api_upload_stimulus():
    if "file" not in request.files:
        return jsonify({"error": "Нет файла (поле file)"}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "Пустое имя файла"}), 400
    raw = secure_filename(f.filename) or "image"
    ext = os.path.splitext(raw)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXT:
        return jsonify(
            {"error": f"Допустимые расширения: {', '.join(sorted(ALLOWED_UPLOAD_EXT))}"}
        ), 400
    _ensure_uploads()
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(_uploads_dir(), name)
    f.save(path)
    root = (request.script_root or "").rstrip("/")
    rel_url = f"{root}/static/uploads/{name}"
    url = _absolutize_url(rel_url)
    return jsonify({"url": url, "filename": name})


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


@app.route("/api/import/docx", methods=["POST"])
def api_import_docx():
    if "file" not in request.files:
        return jsonify({"error": "Нет файла (поле file)"}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "Пустое имя файла"}), 400
    if not f.filename.lower().endswith(".docx"):
        return jsonify({"error": "Поддерживается только формат .docx"}), 400
    try:
        spec, import_warnings = import_docx_to_spec(f.read(), f.filename)
        ssi_payload = _ssi_payload_from_spec(spec)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Ошибка импорта Word: {e}"}), 500
    return jsonify(
        {
            "spec": spec,
            "importWarnings": import_warnings,
            **ssi_payload,
        }
    )


@app.route("/api/convert/ssi-json", methods=["POST"])
def api_convert_ssi_json():
    data = request.get_json(force=True, silent=True) or {}
    if not data.get("blocks"):
        return jsonify({"error": "Нет данных анкеты (blocks)"}), 400
    try:
        return jsonify(_ssi_payload_from_spec(data))
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Ошибка конвертации в SSI JSON: {e}"}), 500


@app.route("/api/validate/ssi-json", methods=["POST"])
def api_validate_ssi_json():
    data = request.get_json(force=True, silent=True) or {}
    questionnaire = data.get("questionnaire")
    raw_text = data.get("raw_text")
    if questionnaire is None and raw_text is None:
        return jsonify({"error": "Нужен questionnaire или raw_text"}), 400
    if questionnaire is None:
        try:
            questionnaire = json.loads(raw_text)
        except Exception as e:  # noqa: BLE001
            return jsonify({"ok": False, "errors": [{"path": "$", "message": f"Некорректный JSON: {e}"}]})
    return jsonify(validate_ssi_questionnaire(questionnaire))


@app.route("/api/export/ssi-json", methods=["POST"])
def api_export_ssi_json():
    data = request.get_json(force=True, silent=True) or {}
    questionnaire = data.get("questionnaire")
    raw_text = data.get("raw_text")
    if questionnaire is None and raw_text is None:
        return jsonify({"error": "Нужен questionnaire или raw_text"}), 400
    if questionnaire is None:
        try:
            questionnaire = json.loads(raw_text)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"Некорректный JSON: {e}"}), 400
    name = _safe_json_filename(str(data.get("filename") or "contractor-ssi-questionnaire"))
    blob = json.dumps(questionnaire, ensure_ascii=False, indent=2).encode("utf-8")
    return send_file(
        io.BytesIO(blob),
        as_attachment=True,
        download_name=name,
        mimetype="application/json",
    )


if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", "5050"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=port, debug=debug)
