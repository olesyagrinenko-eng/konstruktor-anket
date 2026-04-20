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
  /** @type {Map<string, Set<string>>} */
  let selectedTemplates = new Map();
  /** @type {Map<string, Set<string>>} */
  let selectedExtraTemplates = new Map();
  /** @type {object | null} */
  let currentSpec = null;

  const STIMULUS_TYPES = [
    ["video", "cVideo", "Ролик"],
    ["layout", "cLayout", "Макет"],
    ["scenario", "cScenario", "Сценарий"],
    ["concept", "cConcept", "Концепция"],
    ["packaging", "cPack", "Упаковка"],
  ];

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

  function groupAllTids(g) {
    return (g.templates || []).map((t) => t.tid).filter(Boolean);
  }

  function mergeTemplateMapForGroup(gid, allTids) {
    const prev = selectedTemplates.get(gid);
    const allowed = new Set(allTids);
    if (!prev) {
      selectedTemplates.set(gid, new Set(allTids));
      return;
    }
    const next = new Set();
    prev.forEach((t) => {
      if (allowed.has(t)) next.add(t);
    });
    if (next.size === 0) allTids.forEach((t) => next.add(t));
    selectedTemplates.set(gid, next);
  }

  function snapshotAssetFields() {
    const snap = {};
    $$("[id^='asset_']").forEach((el) => {
      if (el.id) snap[el.id] = el.value;
    });
    return snap;
  }

  function applyAssetSnapshot(snap) {
    Object.keys(snap).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = snap[id];
    });
  }

  function collectStimulusAssets() {
    const c = getCounts();
    const out = {
      video: [],
      layout: [],
      scenario: [],
      concept: [],
      packaging: [],
    };
    STIMULUS_TYPES.forEach(([key, cid]) => {
      const n = numVal(cid);
      for (let i = 1; i <= n; i++) {
        const urlEl = document.getElementById(`asset_${key}_${i}_url`);
        const labEl = document.getElementById(`asset_${key}_${i}_label`);
        const url = urlEl ? urlEl.value.trim() : "";
        const label = labEl ? labEl.value.trim() : "";
        out[key].push({ url, label });
      }
    });
    return out;
  }

  async function uploadStimulusFile(file, urlInput) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(apiUrl("/api/upload-stimulus"), {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(j.error || `Загрузка файла: код ${r.status}`);
    }
    if (j.url) urlInput.value = j.url;
  }

  function renderStimulusAssetFields() {
    const host = $("#stimAssetRows");
    if (!host) return;
    const snap = snapshotAssetFields();
    host.innerHTML = "";
    const c = getCounts();
    let any = false;
    STIMULUS_TYPES.forEach(([key, cid, title]) => {
      const n = numVal(cid);
      if (n < 1) return;
      any = true;
      const block = document.createElement("div");
      block.className = "stim-asset-block";
      const h = document.createElement("h4");
      h.textContent = `${title} — ссылка или файл на каждый стимул`;
      block.appendChild(h);
      for (let i = 1; i <= n; i++) {
        const row = document.createElement("div");
        row.className = "stim-asset-row";
        const uwrap = document.createElement("div");
        uwrap.innerHTML =
          `<span class="lbl-mini">URL картинки / превью (#${i})</span>` +
          `<input type="url" id="asset_${key}_${i}_url" placeholder="https://…" class="wide">`;
        const lwrap = document.createElement("div");
        lwrap.innerHTML =
          `<span class="lbl-mini">Подпись для ТЗ (необязательно)</span>` +
          `<input type="text" id="asset_${key}_${i}_label" placeholder="Например: вариант А" class="wide">`;
        const fwrap = document.createElement("div");
        const fl = document.createElement("input");
        fl.type = "file";
        fl.accept = "image/*";
        fl.className = "stim-file-inp";
        const urlInp = uwrap.querySelector("input");
        fl.addEventListener("change", () => {
          const f = fl.files && fl.files[0];
          if (!f) return;
          uploadStimulusFile(f, urlInp).catch((e) => showErr(e.message || "Ошибка загрузки"));
          fl.value = "";
        });
        fwrap.appendChild(document.createTextNode("или файл: "));
        fwrap.appendChild(fl);
        row.appendChild(uwrap);
        row.appendChild(lwrap);
        row.appendChild(fwrap);
        block.appendChild(row);
      }
      host.appendChild(block);
    });
    if (!any) {
      host.innerHTML = '<p class="hint">Увеличьте количество материалов выше, чтобы появились поля для ссылок.</p>';
    } else {
      applyAssetSnapshot(snap);
    }
  }

  function buildPayload() {
    const pn = $("#projectName");
    const fn = $("#freeNotes");
    const template_selection = {};
    selectedGroups.forEach((gid) => {
      const s = selectedTemplates.get(gid);
      template_selection[gid] = s ? Array.from(s) : [];
    });
    const extra_template_selection = {};
    selectedExtras.forEach((eid) => {
      const s = selectedExtraTemplates.get(eid);
      extra_template_selection[eid] = s ? Array.from(s) : [];
    });
    const visibleExtra = new Set(
      (catalog && catalog.extra_options ? catalog.extra_options : [])
        .filter((e) => extraVisibleById(e))
        .map((e) => e.id)
    );
    const extra_ids = Array.from(selectedExtras).filter((id) => visibleExtra.has(id));
    return {
      project_name: pn ? pn.value.trim() : "",
      phase: getPhase(),
      counts: getCounts(),
      group_ids: Array.from(selectedGroups),
      extra_ids,
      template_selection,
      extra_template_selection,
      stimulus_assets: collectStimulusAssets(),
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

  function hideResetConfirmBar() {
    const bar = $("#resetConfirmBar");
    if (bar) bar.classList.add("hidden");
  }

  function showResetConfirmBar() {
    const bar = $("#resetConfirmBar");
    if (bar) {
      bar.classList.remove("hidden");
      try {
        bar.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function goStep(n) {
    showErr("");
    hideResetConfirmBar();
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
    if (n === 2) {
      renderStimulusAssetFields();
    }
    if (n === 3) {
      try {
        await refreshIndicatorPanel();
      } catch (e) {
        console.error(e);
        showErr(
          "Не удалось загрузить показатели. Проверьте соединение и обновите страницу. " +
            (e.message || "")
        );
      }
    }
    if (n === 4) {
      try {
        await refreshExtrasPanel();
      } catch (e) {
        console.error(e);
        showErr(
          "Не удалось загрузить доп. блоки. " + (e.message || "")
        );
      }
    }
  }

  function openResetConfirm() {
    showResetConfirmBar();
  }

  async function performReset() {
    hideResetConfirmBar();
    showErr("");
    const pn = $("#projectName");
    if (pn) pn.value = "";
    const pre = $('input[name="phase"][value="pre"]');
    if (pre) pre.checked = true;
    STIMULUS_TYPES.forEach(([, cid]) => {
      const el = document.getElementById(cid);
      if (el) el.value = "0";
    });
    const fn = $("#freeNotes");
    if (fn) fn.value = "";
    selectedGroups = new Set();
    selectedExtras = new Set();
    selectedTemplates = new Map();
    selectedExtraTemplates = new Map();
    currentSpec = null;
    const host = $("#groupChecks");
    if (host) host.innerHTML = "";
    const exh = $("#extraChecks");
    if (exh) exh.innerHTML = "";
    const stim = $("#stimAssetRows");
    if (stim) stim.innerHTML = "";
    const specOut = $("#specOut");
    if (specOut) {
      specOut.innerHTML =
        '<p class="hint">Нет данных. Пройдите шаги 1–4 и нажмите «Собрать и перейти к структуре».</p>';
    }
    try {
      await goStep(1);
    } catch (e) {
      console.error(e);
      showErr(e.message || "Ошибка при сбросе");
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

  function validateStep3() {
    let ok = false;
    selectedGroups.forEach((gid) => {
      const s = selectedTemplates.get(gid);
      if (s && s.size > 0) ok = true;
    });
    if (!ok) {
      showErr("Отметьте хотя бы один вопрос в типовых показателях (скрининг нельзя отключить полностью).");
      return false;
    }
    return true;
  }

  async function loadCatalog() {
    const r = await fetch(apiUrl("/api/catalog"), {
      credentials: "same-origin",
      cache: "no-store",
    });
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

  function updateGroupMasterState(gid, masterCb) {
    const tids = groupAllTids(catalog.indicator_groups.find((x) => x.id === gid) || { templates: [] });
    const set = selectedTemplates.get(gid) || new Set();
    const n = tids.length;
    const c = tids.filter((t) => set.has(t)).length;
    masterCb.checked = c > 0;
    masterCb.indeterminate = c > 0 && c < n;
  }

  async function refreshIndicatorPanel() {
    if (!catalog) await loadCatalog();
    const payloadBase = {
      project_name: ($("#projectName") && $("#projectName").value.trim()) || "",
      phase: getPhase(),
      counts: getCounts(),
      client_notes: ($("#freeNotes") && $("#freeNotes").value.trim()) || "",
    };
    const sug = await fetch(apiUrl("/api/suggest-groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBase),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!sug.ok) {
      throw new Error(`Подсказки показателей: код ${sug.status}`);
    }
    const sugData = await sug.json();
    const gids = sugData.group_ids;
    if (Array.isArray(gids)) {
      selectedGroups = new Set(gids);
    }
    selectedGroups.add("screening_base");
    Array.from(selectedGroups).forEach((gid) => {
      const g = catalog.indicator_groups.find((x) => x.id === gid);
      if (!g || !groupVisible(g)) {
        selectedGroups.delete(gid);
        selectedTemplates.delete(gid);
      }
    });

    const prevKeys = new Set(selectedTemplates.keys());
    catalog.indicator_groups.forEach((g) => {
      if (!groupVisible(g)) return;
      if (!selectedGroups.has(g.id)) return;
      const allT = groupAllTids(g);
      mergeTemplateMapForGroup(g.id, allT);
      prevKeys.delete(g.id);
    });
    prevKeys.forEach((k) => selectedTemplates.delete(k));

    const host = $("#groupChecks");
    if (!host) return;
    host.innerHTML = "";

    catalog.indicator_groups.forEach((g) => {
      if (!groupVisible(g)) return;
      const locked = g.id === "screening_base";
      if (locked) selectedGroups.add("screening_base");

      const det = document.createElement("details");
      det.className = "tpl-details";
      det.open = true;

      const sum = document.createElement("summary");
      const master = document.createElement("input");
      master.type = "checkbox";
      master.className = "grp-master";
      if (locked) {
        master.checked = true;
        master.disabled = true;
      } else {
        master.checked = selectedGroups.has(g.id);
        master.addEventListener("change", () => {
          if (master.checked) {
            selectedGroups.add(g.id);
            selectedTemplates.set(g.id, new Set(groupAllTids(g)));
          } else {
            selectedGroups.delete(g.id);
            selectedTemplates.delete(g.id);
          }
          det.querySelectorAll(".tpl-cb").forEach((cb) => {
            if (!cb.disabled) {
              cb.checked = master.checked;
            }
          });
          master.indeterminate = false;
        });
      }

      const st = document.createElement("div");
      st.className = "tpl-summary-text";
      st.innerHTML = `<strong>${escapeHtml(g.label)}</strong><small>${escapeHtml(g.description)}</small>`;
      sum.appendChild(master);
      sum.appendChild(st);
      det.appendChild(sum);

      const list = document.createElement("div");
      list.className = "tpl-list";
      const tlist = g.templates || [];
      if (!tlist.length) {
        list.innerHTML = '<span class="hint">Нет шаблонов в каталоге.</span>';
      }
      tlist.forEach((t) => {
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tpl-cb";
        cb.dataset.tid = t.tid;
        const set = selectedTemplates.get(g.id) || new Set();
        const isOn = set.has(t.tid);
        cb.checked = locked ? true : isOn;
        if (locked) cb.disabled = true;
        cb.addEventListener("change", () => {
          if (locked) return;
          let s = selectedTemplates.get(g.id) || new Set();
          if (cb.checked) s.add(t.tid);
          else s.delete(t.tid);
          if (s.size === 0) {
            selectedGroups.delete(g.id);
            selectedTemplates.delete(g.id);
            master.checked = false;
            master.indeterminate = false;
          } else {
            selectedGroups.add(g.id);
            selectedTemplates.set(g.id, s);
            updateGroupMasterState(g.id, master);
          }
        });
        lab.appendChild(cb);
        const tx = document.createElement("span");
        const rp = t.repeat_per ? `Повтор: ${t.repeat_per}` : "Один раз на блок";
        let de = "";
        if (t.layout_debrand_open) {
          de =
            " При наличии роликов в анкете этот вопрос про дебренд по макету не включается (остаётся один вопрос про дебренд: по ролику).";
        }
        tx.innerHTML = `${escapeHtml(t.text || "")}<div class="tpl-meta">${escapeHtml(rp)} · ${escapeHtml(t.qtype || "")}${escapeHtml(de)}</div>`;
        lab.appendChild(tx);
        list.appendChild(lab);
      });
      det.appendChild(list);
      host.appendChild(det);

      if (!locked) {
        updateGroupMasterState(g.id, master);
      }
    });

    if (!host.children.length) {
      host.innerHTML =
        '<p class="chk-empty">Нет групп для текущих материалов. Вернитесь на шаг 2 и укажите хотя бы один стимул.</p>';
    }
  }

  async function refreshExtrasPanel() {
    if (!catalog) await loadCatalog();
    const exh = $("#extraChecks");
    if (!exh) return;
    exh.innerHTML = "";

    catalog.extra_options.forEach((e) => {
      if (!extraVisibleById(e)) return;
      const tlist = e.templates || [];
      const det = document.createElement("details");
      det.className = "tpl-details";
      det.open = true;

      const sum = document.createElement("summary");
      const master = document.createElement("input");
      master.type = "checkbox";
      master.checked = selectedExtras.has(e.id);
      master.addEventListener("change", () => {
        if (master.checked) {
          selectedExtras.add(e.id);
          if (!selectedExtraTemplates.has(e.id)) {
            selectedExtraTemplates.set(e.id, new Set(tlist.map((t) => t.tid).filter(Boolean)));
          }
        } else {
          selectedExtras.delete(e.id);
          selectedExtraTemplates.delete(e.id);
        }
        det.querySelectorAll(".tpl-cb-extra").forEach((cb) => {
          if (!cb.disabled) cb.checked = master.checked;
        });
        master.indeterminate = false;
      });

      const st = document.createElement("div");
      st.className = "tpl-summary-text";
      st.innerHTML = `<strong>${escapeHtml(e.label)}</strong><small>${escapeHtml(e.hint)}</small>`;
      sum.appendChild(master);
      sum.appendChild(st);
      det.appendChild(sum);

      const list = document.createElement("div");
      list.className = "tpl-list";

      if (master.checked && !selectedExtraTemplates.has(e.id)) {
        selectedExtraTemplates.set(e.id, new Set(tlist.map((t) => t.tid).filter(Boolean)));
      }

      tlist.forEach((t) => {
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tpl-cb-extra";
        cb.dataset.tid = t.tid;
        const set = selectedExtraTemplates.get(e.id) || new Set();
        cb.checked = selectedExtras.has(e.id) && set.has(t.tid);
        const onlyOne = tlist.length === 1;
        if (onlyOne) cb.disabled = true;
        cb.addEventListener("change", () => {
          let s = selectedExtraTemplates.get(e.id) || new Set();
          if (cb.checked) s.add(t.tid);
          else s.delete(t.tid);
          if (s.size === 0) {
            selectedExtras.delete(e.id);
            selectedExtraTemplates.delete(e.id);
            master.checked = false;
          } else {
            selectedExtras.add(e.id);
            selectedExtraTemplates.set(e.id, s);
            master.checked = true;
            const all = tlist.map((x) => x.tid).filter(Boolean);
            const on = all.filter((tid) => s.has(tid)).length;
            master.indeterminate = on > 0 && on < all.length;
          }
        });
        lab.appendChild(cb);
        const tx = document.createElement("span");
        const rp = t.repeat_per ? `Повтор: ${t.repeat_per}` : "Один раз на блок";
        tx.innerHTML = `${escapeHtml(t.text || "")}<div class="tpl-meta">${escapeHtml(rp)} · ${escapeHtml(t.qtype || "")}</div>`;
        lab.appendChild(tx);
        list.appendChild(lab);
      });
      det.appendChild(list);
      exh.appendChild(det);
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
        const st = q.stimulus;
        const surl = st && st.asset_url ? escapeHtml(st.asset_url) : "";
        html += `<tr data-bid="${escapeHtml(block.id)}" data-qidx="${qi}">
          <td><code>${escapeHtml(q.id)}</code></td>
          <td><textarea class="f-text">${escapeHtml(q.text)}</textarea>${surl ? `<div class="tpl-meta">Медиа: ${surl}</div>` : ""}</td>
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
    const r = await fetch(apiUrl("/api/build"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store",
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
    try {
      readSpecFromDom();
    } catch (e) {
      console.error(e);
      showErr("Не удалось прочитать правки из таблицы. Проверьте, что все строки заполнены корректно.");
      return;
    }
    const r = await fetch(apiUrl("/api/export/docx"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSpec),
      credentials: "same-origin",
      cache: "no-store",
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);
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

    STIMULUS_TYPES.forEach(([, cid]) => {
      const el = document.getElementById(cid);
      if (el) {
        el.addEventListener("input", () => {
          if (step === 2) renderStimulusAssetFields();
        });
      }
    });

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
            if (!validateStep3()) return;
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

    const bindReset = (id) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", () => openResetConfirm());
    };
    bindReset("btnResetWizard");
    bindReset("btnResetWizardStep5");

    const btnResetConfirm = $("#btnResetConfirm");
    if (btnResetConfirm) {
      btnResetConfirm.addEventListener("click", () =>
        performReset().catch((e) => showErr(e.message || "Ошибка сброса"))
      );
    }
    const btnResetCancel = $("#btnResetCancel");
    if (btnResetCancel) {
      btnResetCancel.addEventListener("click", () => hideResetConfirmBar());
    }

    goStep(1).catch(console.error);
  });
})();
