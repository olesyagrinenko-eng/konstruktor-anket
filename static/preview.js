(function () {
  function $(s, r = document) {
    return r.querySelector(s);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function listOrEmpty(items) {
    return Array.isArray(items) ? items : [];
  }

  function stripTechnicalTail(text) {
    let out = String(text || "").trim();
    out = out.replace(/\bQ\s*\d+\b[\.\:]?/gi, "").trim();
    out = out.replace(/^\s*Экран\s+/i, "").trim();
    out = out.replace(/\b(Открытый|Шкала|Один из списка|Несколько из списка|Клик[- ]?тест|Инструкция)\s*$/i, "").trim();
    out = out.replace(/\s{2,}/g, " ").trim();
    return out;
  }

  function cleanRespondentOption(text) {
    let out = String(text || "").trim();
    out = out.replace(/\s*-\s*закончить интервью.*$/i, "");
    out = out.replace(/\s*-\s*отсев.*$/i, "");
    return out.trim();
  }

  function isTechnicalInstruction(text) {
    const low = String(text || "").toLowerCase().trim();
    if (!low) return false;
    const markers = [
      "закончить интервью",
      "для базы",
      "закодировать",
      "делим выборку",
      "подвыборка",
      "показываем",
      "показать",
      "рандомно",
      "по схеме",
      "q 50",
      "q50",
      "https://",
      "mediaurl",
      "stimulus",
      "вопросы 36",
      "один из списка",
      "несколько из списка",
      "шкала",
      "клик тест",
      "клик-тест",
      "открытый",
      "если меньше",
      "если больше",
      "для верификации",
      "повторный клик",
      "выборка |",
    ];
    if (markers.some((m) => low.includes(m))) return true;
    if (/\|\s*/.test(low)) return true;
    return false;
  }

  function respondentNote(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const lines = raw.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const allowed = lines.filter((line) => !isTechnicalInstruction(line));
    return allowed.join("\n").trim();
  }

  function setStatus(msg, isError) {
    const el = $("#standalonePreviewStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("import-error", !!isError);
  }

  function renderRespondentQuestion(q, index) {
    const cleanTitle = stripTechnicalTail(q.header2 || q.name || `Вопрос ${index + 1}`);
    const title = escapeHtml(cleanTitle || q.name || `Вопрос ${index + 1}`);
    const visibleNote = respondentNote(q.question);
    const note = visibleNote ? `<div class="preview-note">${escapeHtml(visibleNote)}</div>` : "";
    const media = q.meta && q.meta.mediaUrl
      ? `<div class="preview-media"><img src="${escapeAttr(q.meta.mediaUrl)}" alt="${title}"></div>`
      : "";
    if (q.type === "TEXT") {
      return `<section class="preview-card preview-text">${media}<div class="preview-title">${title}</div>${note}<button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "NUMERIC") {
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}<input type="number" class="preview-input" placeholder="Введите число"><button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "OPEN-END") {
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}<textarea class="preview-textarea" placeholder="Введите ответ"></textarea><button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "SELECT") {
      const options = listOrEmpty(q.list).map(cleanRespondentOption).filter(Boolean);
      const inputType = q.selectFormat === "2" ? "checkbox" : "radio";
      const scaleAnchors = q.meta && q.meta.widgetType === "scale"
        ? `<div class="preview-scale-anchors"><span>${escapeHtml(q.meta.minScaleAnchor || "")}</span><span>${escapeHtml(q.meta.maxScaleAnchor || "")}</span></div>`
        : "";
      const opts = options.map((opt) => `<label class="preview-option"><input type="${inputType}" name="${escapeAttr(q.name || `q_${index}`)}"><span>${escapeHtml(opt)}</span></label>`).join("");
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}${scaleAnchors}<div class="preview-options">${opts}</div><button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "GRID" && q.meta && q.meta.widgetType === "click_coord") {
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}<div class="preview-clickmap">Клик-тест: до ${escapeHtml(q.meta.maxPoints || 3)} точек</div><button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "GRID") {
      const rows = listOrEmpty(q.list);
      const cols = listOrEmpty(q.list_column);
      const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
      const body = rows.map((row) => `<tr><th>${escapeHtml(row)}</th>${cols.map(() => '<td><input type="radio" disabled></td>').join("")}</tr>`).join("");
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}<div class="preview-grid-wrap"><table class="preview-grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div><button type="button" class="preview-next">Далее</button></section>`;
    }
    if (q.type === "GRID_HYBRID") {
      const rows = listOrEmpty(q.list);
      return `<section class="preview-card">${media}<div class="preview-step">Вопрос ${index + 1}</div><div class="preview-title">${title}</div>${note}<div class="preview-hybrid">${rows.map((row) => `<label class="preview-hybrid-row"><span>${escapeHtml(row || "Ответ")}</span><input type="text" class="preview-input"></label>`).join("")}</div><button type="button" class="preview-next">Далее</button></section>`;
    }
    return `<section class="preview-card"><div class="preview-title">${title}</div><div class="preview-unknown">Нет рендера для типа ${escapeHtml(q.type || "unknown")}</div></section>`;
  }

  function renderDebugQuestion(q, index) {
    const rows = Object.entries(q || {}).map(([k, v]) => `<div class="preview-debug-row"><strong>${escapeHtml(k)}</strong><pre>${escapeHtml(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</pre></div>`).join("");
    return `<section class="preview-card preview-debug-card"><div class="preview-step">Элемент ${index + 1}</div><div class="preview-title">${escapeHtml(q.header2 || q.name || `Item ${index + 1}`)}</div><div class="preview-debug-table">${rows}</div></section>`;
  }

  let previewMode = "respondent";
  let previewIndex = 0;
  let data = [];

  function syncNav() {
    const nav = $("#standalonePreviewNav");
    const counter = $("#standalonePreviewCounter");
    const prev = $("#btnStandalonePrev");
    const next = $("#btnStandaloneNext");
    nav.classList.toggle("hidden", data.length <= 1);
    counter.textContent = data.length ? `Экран ${previewIndex + 1} из ${data.length}` : "";
    prev.disabled = previewIndex <= 0;
    next.disabled = previewIndex >= data.length - 1;
  }

  function renderCurrent() {
    const host = $("#standalonePreviewHost");
    if (!Array.isArray(data) || !data.length) {
      host.innerHTML = '<p class="hint">Нет данных для preview. Сначала откройте preview из конструктора.</p>';
      setStatus("JSON для preview не найден в браузере.", true);
      syncNav();
      return;
    }
    previewIndex = Math.max(0, Math.min(previewIndex, data.length - 1));
    host.innerHTML = previewMode === "debug"
      ? renderDebugQuestion(data[previewIndex], previewIndex)
      : renderRespondentQuestion(data[previewIndex], previewIndex);
    setStatus(previewMode === "debug" ? "Показан debug preview." : "Показан respondent preview.", false);
    syncNav();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    previewMode = params.get("mode") === "debug" ? "debug" : "respondent";
    try {
      data = JSON.parse(localStorage.getItem("konstruktor-preview-json") || "[]");
    } catch (_) {
      data = [];
    }
    $("#btnStandaloneRespondent").addEventListener("click", () => {
      previewMode = "respondent";
      previewIndex = 0;
      renderCurrent();
    });
    $("#btnStandaloneDebug").addEventListener("click", () => {
      previewMode = "debug";
      previewIndex = 0;
      renderCurrent();
    });
    $("#btnStandalonePrev").addEventListener("click", () => {
      previewIndex = Math.max(0, previewIndex - 1);
      renderCurrent();
    });
    $("#btnStandaloneNext").addEventListener("click", () => {
      previewIndex = Math.min(data.length - 1, previewIndex + 1);
      renderCurrent();
    });
    renderCurrent();
  });
})();
