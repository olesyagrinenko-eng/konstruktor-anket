(function () {
  const API_PREFIX = (() => {
    const m = document.querySelector('meta[name="api-prefix"]');
    let p = (m && m.getAttribute("content")) || "";
    if (p.endsWith("/")) p = p.slice(0, -1);
    return p;
  })();

  function apiUrl(path) {
    return API_PREFIX + path;
  }

  const STEPS = 5;
  let step = 1;
  let catalog = null;
  let selectedGroups = new Set();
  let selectedExtras = new Set();
  /** @type {object | null} */
  let currentSpec = null;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function showErr(msg) {
    const el = $("#errGlobal");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function getPhase() {
    const r = $('input[name="phase"]:checked');
    return r ? r.value : "pre";
  }

  function numVal(id) {
    const el = document.getElementById(id);
    return Math.max(0, parseInt(el && el.value, 10) || 0);
  }

  function getCounts() {
    return {
      video: numVal("cVideo"),
      layout: numVal("cLayout"),
      scenario: numVal("cScenario"),
      concept: numVal("cConcept"),
      packaging: numVal("cPack"),
    };
  }

  function computeActive() {
    const c = getCounts();
    const a = new Set();
    if (c.video > 0) a.add("video");
    if (c.layout > 0) a.add("layout");
    if (c.scenario > 0) a.add("scenario");
    if (c.concept > 0) a.add("concept");
    if (c.packaging > 0) a.add("packaging");
    return a;
  }

  function groupVisible(g) {
    const phase = getPhase();
    if (g.phase === "post_only" && phase !== "post") return false;
    const fs = g.for_stimuli || [];
    if (!fs.length) return true;
    const act = computeActive();
    return fs.some((s) => act.has(s));
  }

  function buildPayload() {
    const pn = $("#projectName");
    const fn = $("#freeNotes");
    return {
      project_name: pn ? pn.value.trim() : "",
      phase: getPhase(),
      counts: getCounts(),
      group_ids: Array.from(selectedGroups),
      extra_ids: Array.from(selectedExtras),
      client_notes: fn ? fn.value.trim() : "",
      custom_questions: [],
    };
  }

  function renderStepNav() {
    const nav = $("#stepNav");
    if (!nav) return;
    nav.innerHTML = "";
    for (let i = 1; i <= STEPS; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(i);
      b.classList.toggle("active", i === step);
      b.addEventListener("click", () => {
        goStep(i).catch((e) => {
          console.error(e);
          showErr(e.message || "Ошибка при переходе на шаг");
        });
      });
      nav.appendChild(b);
    }
  }

  async function goStep(n) {
    showErr("");
    $$(".step").forEach((p) => {
      p.classList.toggle("hidden", parseInt(p.dataset.step, 10) !== n);
    });
    step = n;
    renderStepNav();
    const prev = $("#btnPrev");
    const next = $("#btnNext");
    if (prev) prev.classList.toggle("hidden", n === 1);
    if (next) {
      next.classList.toggle("hidden", n === STEPS);
      next.textContent = n === 4 ? "Собрать и перейти к структуре" : "Далее";
    }
    // Шаги 3–4: всегда перезаполняем списки (в т.ч. при клике по номеру шага в навигации)
    if (n === 3 || n === 4) {
      try {
        await refreshGroupSelectors();
      } catch (e) {
        console.error(e);
        showErr(
          "Не удалось загрузить показатели. Проверьте соединение и обновите страницу. " +
            (e.message || "")
        );
      }
    }
  }

  function validateStep2() {
    const c = getCounts();
    const t = Object.values(c).reduce((s, x) => s + x, 0);
    if (t < 1) {
      showErr("Укажите хотя бы один материал с количеством больше 0.");
      return false;
    }
    return true;
  }

  async function loadCatalog() {
    const r = await fetch(apiUrl("/api/catalog"), { credentials: "same-origin" });
    if (!r.ok) {
      throw new Error(`Каталог недоступен (код ${r.status}).`);
    }
    const data = await r.json();
    if (!data.indicator_groups || !data.extra_options) {
      throw new Error("Некорректный ответ сервера: нет списков показателей.");
    }
    catalog = data;
  }

  function extraVisibleById(e) {
    const fs = e.for_stimuli || [];
    if (!fs.length) return true;
    const act = computeActive();
    return fs.some((s) => act.has(s));
  }

  async function refreshGroupSelectors() {
    if (!catalog) {
      await loadCatalog();
    }
    const payload = buildPayload();
    const sug = await fetch(apiUrl("/api/suggest-groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    if (!sug.ok) {
      throw new Error(`Подсказки показателей: код ${sug.status}`);
    }
    const sugData = await sug.json();
    const gids = sugData.group_ids;
    if (Array.isArray(gids)) {
      selectedGroups = new Set(gids);
    }

    const host = $("#groupChecks");
    const exh = $("#extraChecks");
    if (!host || !exh) return;

    host.innerHTML = "";
    catalog.indicator_groups.forEach((g) => {
      if (!groupVisible(g)) return;
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = g.id;
      const locked = g.id === "screening_base";
      if (locked) {
        selectedGroups.add("screening_base");
        cb.checked = true;
        cb.disabled = true;
      } else {
        cb.checked = selectedGroups.has(g.id);
      }
      cb.addEventListener("change", () => {
        if (cb.disabled) return;
        if (cb.checked) selectedGroups.add(g.id);
        else selectedGroups.delete(g.id);
      });
      lab.appendChild(cb);
      const span = document.createElement("span");
      span.innerHTML = `<strong>${escapeHtml(g.label)}</strong><small>${escapeHtml(g.description)}</small>`;
      lab.appendChild(span);
      host.appendChild(lab);
    });

    if (!host.children.length) {
      host.innerHTML =
        '<p class="chk-empty">Нет групп для текущих материалов. Вернитесь на шаг 2 и укажите хотя бы один стимул.</p>';
    }

    exh.innerHTML = "";
    catalog.extra_options.forEach((e) => {
      if (!extraVisibleById(e)) return;
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = e.id;
      cb.checked = selectedExtras.has(e.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedExtras.add(e.id);
        else selectedExtras.delete(e.id);
      });
      lab.appendChild(cb);
      const span = document.createElement("span");
      span.innerHTML = `<strong>${escapeHtml(e.label)}</strong><small>${escapeHtml(e.hint)}</small>`;
      lab.appendChild(span);
      exh.appendChild(lab);
    });

    if (!exh.children.length) {
      exh.innerHTML =
        '<p class="chk-empty">Нет дополнительных блоков для выбранных материалов (например, клик-тест нужен при наличии макетов).</p>';
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const Q_TYPES = [
    ["open", "Открытый"],
    ["open_numeric", "Число"],
    ["single", "Один из списка"],
    ["multi", "Несколько из списка"],
    ["multi_placeholder", "Мультивыбор (список в ТЗ)"],
    ["scale_1_9", "Шкала 1–9"],
    ["scale_1_5", "Шкала 1–5"],
    ["instruction", "Инструкция"],
    ["click_map", "Клик-тест"],
  ];

  function optionsToStr(opts) {
    if (!opts || !opts.length) return "";
    return opts.join("; ");
  }

  function strToOptions(s) {
    return String(s || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function parseAnchors(s) {
    const parts = String(s || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    const o = {};
    parts.forEach((p) => {
      const m = p.match(/^(\d+)\s*[:=]\s*(.+)$/);
      if (m) o[m[1]] = m[2].trim();
    });
    return Object.keys(o).length ? o : null;
  }

  function anchorsToStr(a) {
    if (!a) return "";
    return Object.keys(a)
      .sort()
      .map((k) => `${k}: ${a[k]}`)
      .join("; ");
  }

  function renderSpec() {
    const out = $("#specOut");
    if (!currentSpec) {
      out.innerHTML = "<p class=\"hint\">Нет данных. Нажмите «Пересобрать».</p>";
      return;
    }
    let html = "";
    currentSpec.blocks.forEach((block) => {
      html += `<div class="block-title">${escapeHtml(block.title)}</div>`;
      if (block.programmer_instructions) {
        html += `<p class="hint"><em>Инструкция программисту:</em> ${escapeHtml(block.programmer_instructions)}</p>`;
      }
      html += `<table class="spec"><thead><tr>
        <th>ID</th><th>Формулировка</th><th>Тип</th><th>Варианты (через ;)</th><th>Шкала (1:мин;9:макс)</th><th>Заметка программисту</th><th></th>
      </tr></thead><tbody>`;
      block.questions.forEach((q, qi) => {
        const opts = optionsToStr(q.options);
        const anch = anchorsToStr(q.anchors);
        let typeOpts = Q_TYPES.map(
          ([v, l]) => `<option value="${v}" ${q.qtype === v ? "selected" : ""}>${l}</option>`
        ).join("");
        html += `<tr data-bid="${escapeHtml(block.id)}" data-qidx="${qi}">
          <td><code>${escapeHtml(q.id)}</code></td>
          <td><textarea class="f-text">${escapeHtml(q.text)}</textarea></td>
          <td><select class="f-type">${typeOpts}</select></td>
          <td><textarea class="f-opts" rows="2">${escapeHtml(opts)}</textarea></td>
          <td><input type="text" class="f-anch" value="${escapeHtml(anch)}"></td>
          <td><textarea class="f-note" rows="2">${escapeHtml(q.programmer_note || "")}</textarea></td>
          <td><button type="button" class="secondary row-del" title="Удалить">×</button></td>
        </tr>`;
      });
      html += `</tbody></table>`;
    });
    out.innerHTML = html;

    out.querySelectorAll("tr[data-bid]").forEach((tr) => {
      const bid = tr.dataset.bid;
      const qidx = parseInt(tr.dataset.qidx, 10);
      tr.querySelector(".row-del").addEventListener("click", () => {
        const b = currentSpec.blocks.find((x) => x.id === bid);
        if (b && b.questions[qidx] !== undefined) {
          b.questions.splice(qidx, 1);
          renderSpec();
        }
      });
    });
  }

  function readSpecFromDom() {
    if (!currentSpec) return;
    $("#specOut").querySelectorAll("tr[data-bid]").forEach((tr) => {
      const bid = tr.dataset.bid;
      const qidx = parseInt(tr.dataset.qidx, 10);
      const b = currentSpec.blocks.find((x) => x.id === bid);
      if (!b || !b.questions[qidx]) return;
      const q = b.questions[qidx];
      q.text = tr.querySelector(".f-text").value.trim();
      q.qtype = tr.querySelector(".f-type").value;
      const opts = strToOptions(tr.querySelector(".f-opts").value);
      q.options = opts.length ? opts : null;
      const anch = parseAnchors(tr.querySelector(".f-anch").value);
      q.anchors = anch;
      q.programmer_note = tr.querySelector(".f-note").value.trim();
    });
  }

  async function runBuild() {
    showErr("");
    const payload = buildPayload();
    payload.group_ids = Array.from(selectedGroups);
    payload.extra_ids = Array.from(selectedExtras);
    const r = await fetch(apiUrl("/api/build"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    if (!r.ok) {
      showErr("Ошибка сборки анкеты.");
      return;
    }
    currentSpec = await r.json();
    renderSpec();
  }

  async function exportDocx() {
    if (!currentSpec) return;
    readSpecFromDom();
    const r = await fetch(apiUrl("/api/export/docx"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSpec),
      credentials: "same-origin",
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showErr(j.error || "Ошибка экспорта");
      return;
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition");
    let name = "anketa.docx";
    if (cd && cd.includes("filename=")) {
      const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
      if (m) name = decodeURIComponent(m[1]);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function addCustomQuestion() {
    if (!currentSpec) await runBuild();
    if (!currentSpec) return;
    readSpecFromDom();
    let b = currentSpec.blocks.find((x) => x.id === "blk_custom");
    if (!b) {
      b = {
        id: "blk_custom",
        title: "Пользовательские вопросы",
        programmer_instructions: "Добавлено в конструкторе.",
        questions: [],
      };
      currentSpec.blocks.push(b);
    }
    const n = b.questions.length + 1;
    b.questions.push({
      id: "custom_" + String(n).padStart(3, "0"),
      qtype: "open",
      text: "Новый вопрос — отредактируйте формулировку",
      programmer_note: "",
      options: null,
      anchors: null,
      stimulus: null,
    });
    renderSpec();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await loadCatalog();
    } catch (e) {
      console.error(e);
      showErr(
        "Не загрузился каталог с сервера. Кнопки работают, но шаги 3–4 заполнятся только после успешной загрузки — обновите страницу или проверьте URL приложения (откройте сайт через тот же адрес, где работает API)."
      );
    }

    renderStepNav();

    const btnNext = $("#btnNext");
    if (btnNext) {
      btnNext.addEventListener("click", async () => {
        showErr("");
        try {
          if (step === 1) {
            await goStep(2);
            return;
          }
          if (step === 2) {
            if (!validateStep2()) return;
            await goStep(3);
            return;
          }
          if (step === 3) {
            await goStep(4);
            return;
          }
          if (step === 4) {
            await goStep(5);
            await runBuild();
            return;
          }
        } catch (e) {
          console.error(e);
          showErr(e.message || "Ошибка");
        }
      });
    }

    const btnPrev = $("#btnPrev");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (step > 1) {
          goStep(step - 1).catch((e) => {
            console.error(e);
            showErr(e.message || "Ошибка");
          });
        }
      });
    }

    const br = $("#btnRebuild");
    if (br) br.addEventListener("click", () => runBuild().catch((e) => showErr(e.message || "Ошибка сборки")));

    const be = $("#btnExport");
    if (be) be.addEventListener("click", () => exportDocx().catch((e) => showErr(e.message || "Ошибка экспорта")));

    const ba = $("#btnAddQ");
    if (ba) ba.addEventListener("click", () => addCustomQuestion().catch(console.error));

    goStep(1).catch(console.error);
  });
})();
