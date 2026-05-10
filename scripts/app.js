/* App entry — wires up DOM events, recording, mock AI parse, save. */

(function () {
  const { State, Router } = window;

  const REC_LIMIT_SEC = 180; // 3 min hard cap

  let recTimer = null;
  let recStart = 0;
  let recognition = null;
  let speechErrored = false;
  let rawText = "";
  let parseTimer = null;

  // remember the original text and the failed draft so retry / manual / copy can reach them
  let lastParseText = "";
  let pendingSave = null;

  // ----- DOM helpers -----
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg, kind) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast" + (kind ? " is-" + kind : "");
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 2400);
  }

  // ===== Network banner =====
  function syncNetBanner() {
    const banner = $("#net-banner");
    if (!banner) return;
    banner.hidden = navigator.onLine;
  }
  window.addEventListener("online",  syncNetBanner);
  window.addEventListener("offline", syncNetBanner);

  // ===== Tabs =====
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    const target = tab.dataset.tabTarget;
    if (target === "stories") renderStoryList();
    Router.show(target);
  });

  // ===== Home: start recording =====
  $("#btn-start-record").addEventListener("click", startRecording);
  $("#btn-empty-record")?.addEventListener("click", startRecording);

  // ===== Recording controls =====
  $("#btn-stop-record").addEventListener("click", () => stopRecording(false));
  $("#btn-cancel-record").addEventListener("click", cancelRecording);

  // ===== Parsing screen — error block actions =====
  $("#btn-parse-retry").addEventListener("click", () => {
    hideParseError();
    runParseSteps();
    finishParse(lastParseText);
  });
  $("#btn-parse-manual").addEventListener("click", () => {
    hideParseError();
    const draft = freshDraft(lastParseText);
    State.setDraft(draft);
    renderConfirm(draft);
    Router.show("confirm");
  });

  // ===== Confirm =====
  $("#btn-confirm-back").addEventListener("click", () => Router.show("home"));
  $("#btn-redo").addEventListener("click", () => {
    State.clearDraft();
    startRecording();
  });
  $("#btn-save").addEventListener("click", handleSave);

  bindChipInput("#input-theme",   "themes",   "#chips-themes");
  bindChipInput("#input-element", "elements", "#chips-elements");

  // ===== Saved =====
  $("#btn-go-stories").addEventListener("click", () => {
    renderStoryList();
    Router.show("stories");
  });
  $("#btn-go-home").addEventListener("click", () => Router.show("home"));

  // ===== Stories =====
  $("#btn-open-settings").addEventListener("click", () => {
    renderSettings();
    Router.show("settings");
  });
  $("#story-search").addEventListener("input", () => renderStoryList());

  // ===== Settings =====
  $("#btn-settings-back").addEventListener("click", () => Router.show("stories"));
  $("#btn-bind-google").addEventListener("click", () => openOAuth());
  $("#btn-rebuild-sheet").addEventListener("click", () => {
    if (!State.isGoogleConnected()) {
      toast("请先绑定 Google 账号", "error");
      return;
    }
    toast("已请求重建数据表（演示）", "success");
  });
  $("#btn-load-demo").addEventListener("click", () => {
    State.loadDemoData();
    toast("已加载示例数据", "success");
    renderStoryList();
  });
  $("#btn-clear-all").addEventListener("click", () => {
    if (!confirm("确定要清空所有梦境记录？此操作无法撤销。")) return;
    State.clearAllDreams();
    toast("已清空", "success");
    renderStoryList();
  });
  $("#btn-toggle-fail").addEventListener("click", () => {
    State.setDebugFail(!State.isDebugFail());
    renderSettings();
  });

  // ===== Detail =====
  $("#btn-detail-back").addEventListener("click", () => Router.show("stories"));

  // ===== OAuth modal =====
  $("#btn-oauth-cancel").addEventListener("click", () => {
    $("#modal-oauth").hidden = true;
  });
  $("#btn-oauth-confirm").addEventListener("click", () => {
    State.setGoogleConnected(true);
    $("#modal-oauth").hidden = true;
    toast("Google 账号已绑定（演示）", "success");
    renderSettings();
    if (pendingSave) {
      const d = pendingSave;
      pendingSave = null;
      finalizeSave(d);
    }
  });

  function openOAuth() {
    $("#modal-oauth").hidden = false;
  }

  // ===== Save error modal =====
  $("#btn-save-retry").addEventListener("click", () => {
    $("#modal-save-error").hidden = true;
    if (!pendingSave) return;
    finalizeSave(pendingSave);
  });
  $("#btn-save-copy").addEventListener("click", async () => {
    if (!pendingSave) return;
    const d = pendingSave;
    const text =
      `日期：${d.date}\n` +
      `心情：${d.tags.mood || ""}\n` +
      `主题：${(d.tags.themes   || []).join("，")}\n` +
      `元素：${(d.tags.elements || []).join("，")}\n\n` +
      `摘要：\n${d.summary || ""}\n\n` +
      `原文：\n${d.raw || ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板", "success");
    } catch (_) {
      toast("复制失败，请手动选择", "error");
    }
  });

  // ============================================================
  //   Recording
  // ============================================================
  function startRecording() {
    rawText = "";
    speechErrored = false;
    Router.show("recording");
    $("#rec-timer").textContent = "00:00";

    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast("当前浏览器不支持语音识别，已切换为手动模式", "error");
      setTimeout(() => goToParse(""), 600);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
      }
      if (finalChunk) rawText += finalChunk;
    };

    recognition.onerror = (e) => {
      if (speechErrored) return;
      speechErrored = true;
      const msg = e.error === "not-allowed"
        ? "麦克风权限被拒绝，已切换为手动模式"
        : e.error === "no-speech"
        ? "没有检测到语音，已切换为手动模式"
        : "语音识别出错，已切换为手动模式";
      toast(msg, "error");
      cleanupRecognition();
      // Drop the user into the confirm screen with whatever raw we already captured.
      const draft = freshDraft(rawText.trim());
      State.setDraft(draft);
      renderConfirm(draft);
      Router.show("confirm");
    };

    try {
      recognition.start();
    } catch (e) {
      console.warn(e);
    }

    recStart = Date.now();
    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStart) / 1000);
      $("#rec-timer").textContent = formatMMSS(sec);
      if (sec >= REC_LIMIT_SEC) {
        stopRecording(true);
      }
    }, 250);
  }

  function stopRecording(autoStopped) {
    cleanupRecognition();
    if (speechErrored) return; // error path already handled the transition
    if (autoStopped) toast("已达 3 分钟上限，自动停止", "");
    goToParse(rawText.trim());
  }

  function cancelRecording() {
    cleanupRecognition();
    rawText = "";
    Router.show("home");
  }

  function cleanupRecognition() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
  }

  function formatMMSS(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  // ============================================================
  //   Parse (mock LLM)
  // ============================================================
  function goToParse(text) {
    Router.show("parsing");
    hideParseError();
    runParseSteps();

    if (!text || text.length < 5) {
      // Treat very short input as a manual case (no real AI call).
      setTimeout(() => {
        clearParseSteps();
        const draft = freshDraft(text || "");
        State.setDraft(draft);
        renderConfirm(draft);
        Router.show("confirm");
        if (text) toast("录音内容很短，请手动补充", "");
      }, 1400);
      return;
    }

    finishParse(text);
  }

  function finishParse(text) {
    lastParseText = text;
    setTimeout(() => {
      // Debug toggle simulates an LLM failure for testing the error UI.
      if (State.isDebugFail()) {
        clearParseSteps();
        showParseError();
        return;
      }
      clearParseSteps();
      const draft = mockParse(text);
      State.setDraft(draft);
      renderConfirm(draft);
      Router.show("confirm");
    }, 2400);
  }

  function showParseError() {
    $("#parse-steps").hidden = true;
    $("#parse-error").hidden = false;
  }
  function hideParseError() {
    $("#parse-error").hidden = true;
    $("#parse-steps").hidden = false;
  }

  function runParseSteps() {
    const items = $$("#parse-steps li");
    items.forEach((li) => li.classList.remove("is-active", "is-done"));
    let i = 0;
    const tick = () => {
      if (i > 0) items[i - 1].classList.replace("is-active", "is-done");
      if (i < items.length) {
        items[i].classList.add("is-active");
        i++;
        parseTimer = setTimeout(tick, 600);
      }
    };
    tick();
  }

  function clearParseSteps() {
    if (parseTimer) { clearTimeout(parseTimer); parseTimer = null; }
    $$("#parse-steps li").forEach((li) => {
      li.classList.remove("is-active");
      li.classList.add("is-done");
    });
  }

  function freshDraft(text) {
    return {
      id: State.newId(),
      date: State.todayISO(),
      tags: { mood: "奇幻", themes: [], elements: [] },
      summary: "",
      raw: text || ""
    };
  }

  // Tiny heuristic "AI" so the demo feels alive without an API key.
  function mockParse(text) {
    const draft = freshDraft(text);

    const moodHits = [
      { mood: "恐怖/惊悚", words: ["恐怖", "惊悚", "蟑螂", "鬼", "尸", "黑暗"] },
      { mood: "焦虑",       words: ["追", "迟到", "考试", "找不到", "晚了", "丢"] },
      { mood: "温暖",       words: ["家人", "外婆", "祖母", "厨房", "阳光", "笑"] },
      { mood: "悲伤",       words: ["哭", "离别", "走了", "葬礼"] },
      { mood: "奇幻",       words: ["飞", "魔法", "城堡", "森林", "龙", "异世界"] },
      { mood: "平静",       words: ["海", "湖", "雨", "安静"] }
    ];
    for (const m of moodHits) {
      if (m.words.some((w) => text.includes(w))) { draft.tags.mood = m.mood; break; }
    }

    const possibleThemes = ["逃离", "追逐", "迷路", "返回", "童年", "考试", "飞行", "旅行", "失去", "重逢", "密室", "轮回"];
    const possibleElems  = ["楼梯", "厨房", "通道", "蟑螂", "森林", "海", "灯", "雨", "镜子", "门", "钥匙", "陌生人"];

    draft.tags.themes   = possibleThemes.filter((w) => text.includes(w)).slice(0, 4);
    draft.tags.elements = possibleElems.filter((w) => text.includes(w)).slice(0, 4);

    const sentences = text.split(/[。.！？!?\n]/).map((s) => s.trim()).filter(Boolean);
    draft.summary = sentences.length === 0
      ? text.slice(0, 80)
      : sentences.slice(0, 2).join("。") + "。";

    return draft;
  }

  // ============================================================
  //   Confirm screen
  // ============================================================
  function renderConfirm(d) {
    $("#f-date").value    = d.date;
    $("#f-mood").value    = d.tags.mood || "奇幻";
    $("#f-summary").value = d.summary || "";
    $("#f-raw").value     = d.raw || "";
    renderChips("#chips-themes",   d.tags.themes,   "themes");
    renderChips("#chips-elements", d.tags.elements, "elements");
  }

  function renderChips(sel, list, kind) {
    const wrap = $(sel);
    wrap.innerHTML = "";
    (list || []).forEach((label, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = label;
      const x = document.createElement("button");
      x.className = "chip__x";
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", "删除");
      x.addEventListener("click", () => {
        const draft = State.getDraft();
        if (!draft) return;
        draft.tags[kind].splice(idx, 1);
        renderChips(sel, draft.tags[kind], kind);
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
  }

  function bindChipInput(inputSel, kind, listSel) {
    const inp = $(inputSel);
    if (!inp) return;
    inp.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const draft = State.getDraft();
      if (!draft) return;
      if (!draft.tags[kind].includes(v)) {
        draft.tags[kind].push(v);
        renderChips(listSel, draft.tags[kind], kind);
      }
      inp.value = "";
    });
  }

  function readDraftFromForm() {
    const d = State.getDraft();
    if (!d) return null;
    d.date    = $("#f-date").value || State.todayISO();
    d.tags.mood = $("#f-mood").value;
    d.summary = $("#f-summary").value.trim();
    d.raw     = $("#f-raw").value.trim();
    return d;
  }

  function handleSave() {
    const d = readDraftFromForm();
    if (!d) return;
    if (!d.summary && !d.raw) {
      toast("摘要和原文都为空，写点什么吧", "error");
      return;
    }
    if (!State.isGoogleConnected()) {
      pendingSave = d;
      openOAuth();
      return;
    }
    finalizeSave(d);
  }

  function finalizeSave(d) {
    // Debug toggle simulates a Sheets write failure for testing the error UI.
    if (State.isDebugFail()) {
      pendingSave = d;
      $("#modal-save-error").hidden = false;
      return;
    }
    State.addDream(d);
    State.clearDraft();
    pendingSave = null;
    Router.show("saved");
  }

  // ============================================================
  //   Stories list
  // ============================================================
  function renderStoryList() {
    const list = State.getDreams();
    const q = ($("#story-search")?.value || "").trim().toLowerCase();
    const filtered = q
      ? list.filter((d) => {
          const hay = [
            d.summary, d.raw, d.tags.mood,
            ...(d.tags.themes || []),
            ...(d.tags.elements || [])
          ].join(" ").toLowerCase();
          return hay.includes(q);
        })
      : list;

    const wrap = $("#story-list");
    const empty = $("#story-empty");
    wrap.innerHTML = "";

    if (filtered.length === 0) {
      empty.hidden = false;
      wrap.hidden = true;
      return;
    }
    empty.hidden = true;
    wrap.hidden = false;

    filtered.forEach((d) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "story-card";
      card.innerHTML = `
        <div class="story-card__date">${formatDate(d.date)} · ${escapeHTML(d.tags.mood || "")}</div>
        <div class="story-card__summary">${escapeHTML(d.summary || d.raw || "")}</div>
        <div class="story-card__tags">
          ${(d.tags.themes || []).slice(0, 4).map(t => `<span class="story-card__tag">${escapeHTML(t)}</span>`).join("")}
        </div>
      `;
      card.addEventListener("click", () => openDetail(d.id));
      wrap.appendChild(card);
    });
  }

  function openDetail(id) {
    const d = State.getDream(id);
    if (!d) return;
    $("#detail-date").textContent = formatDate(d.date);
    $("#detail-mood").textContent = d.tags.mood || "";
    $("#detail-summary").textContent = d.summary || "（无摘要）";
    $("#detail-raw").textContent = d.raw || "（无原文）";

    fillReadonlyChips("#detail-themes",   d.tags.themes);
    fillReadonlyChips("#detail-elements", d.tags.elements);

    Router.show("storyDetail");
  }

  function fillReadonlyChips(sel, list) {
    const wrap = $(sel);
    wrap.innerHTML = "";
    (list || []).forEach((label) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = label;
      wrap.appendChild(c);
    });
  }

  // ============================================================
  //   Settings
  // ============================================================
  function renderSettings() {
    const connected = State.isGoogleConnected();
    $("#settings-google-status").textContent = connected ? "已绑定（演示）" : "未绑定";
    $("#settings-sheet-status").textContent  = connected ? (State.getSheetName() || "Morpheus Dreams") : "尚未创建";
    $("#btn-bind-google").textContent = connected ? "重新绑定" : "绑定 Google";

    const failOn = State.isDebugFail();
    $("#settings-debug-status").textContent = failOn
      ? "已开启 — 解析与保存会失败"
      : "关闭中";
    const btn = $("#btn-toggle-fail");
    btn.textContent = failOn ? "关闭" : "开启";
    btn.classList.toggle("is-on", failOn);
  }

  // ============================================================
  //   Helpers
  // ============================================================
  function escapeHTML(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(+d)) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  }

  // ============================================================
  //   Boot
  // ============================================================
  syncNetBanner();
  Router.show("home");
})();
