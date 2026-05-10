/* App entry — wires up DOM events, recording, mock AI parse, save. */

(function () {
  const { State, Router } = window;

  const REC_LIMIT_SEC = 180; // 3 min hard cap

  let recTimer = null;
  let recStart = 0;
  let recognition = null;
  let rawText = "";
  let parseTimer = null;

  // ----- DOM helpers -----
  const $ = (sel, root = document) => root.querySelector(sel);
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
  $("#btn-stop-record").addEventListener("click", stopRecording);
  $("#btn-cancel-record").addEventListener("click", cancelRecording);

  // ===== Confirm =====
  $("#btn-confirm-back").addEventListener("click", () => Router.show("home"));
  $("#btn-redo").addEventListener("click", () => {
    State.clearDraft();
    startRecording();
  });
  $("#btn-save").addEventListener("click", handleSave);

  // chip inputs
  bindChipInput("#input-theme", "themes", "#chips-themes");
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
    toast("已请求重建数据表（mock）", "success");
  });

  // ===== Detail =====
  $("#btn-detail-back").addEventListener("click", () => Router.show("stories"));

  // ===== OAuth modal =====
  $("#btn-oauth-cancel").addEventListener("click", () => {
    $("#modal-oauth").hidden = true;
  });
  $("#btn-oauth-confirm").addEventListener("click", () => {
    // Mock OAuth: just mark as connected.
    State.setGoogleConnected(true);
    $("#modal-oauth").hidden = true;
    toast("Google 账号已绑定", "success");
    renderSettings();
    // If a save was waiting on auth, resume it.
    if (pendingSave) {
      const draft = pendingSave;
      pendingSave = null;
      finalizeSave(draft);
    }
  });

  let pendingSave = null;
  function openOAuth() {
    $("#modal-oauth").hidden = false;
  }

  // ============================================================
  //   Recording
  // ============================================================
  function startRecording() {
    rawText = "";
    Router.show("recording");
    $("#rec-timer").textContent = "00:00";

    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      // Fallback: skip straight to manual confirm with empty text.
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
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) rawText += finalChunk;
      // We don't display the live transcript on this minimal screen,
      // but keep the variable in scope in case the user wants to add it later.
    };

    recognition.onerror = (e) => {
      console.warn("speech error", e.error);
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
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      recognition = null;
    }
    if (autoStopped) toast("已达 3 分钟上限，自动停止", "");
    goToParse(rawText.trim());
  }

  function cancelRecording() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    rawText = "";
    Router.show("home");
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
    runParseSteps();

    // If user gave us essentially nothing, drop straight to manual confirm.
    if (!text || text.length < 5) {
      setTimeout(() => {
        clearParseSteps();
        const draft = freshDraft("");
        State.setDraft(draft);
        renderConfirm(draft);
        Router.show("confirm");
        toast("录音内容很短，请手动补充", "");
      }, 1600);
      return;
    }

    // Mock parse latency
    setTimeout(() => {
      clearParseSteps();
      const draft = mockParse(text);
      State.setDraft(draft);
      renderConfirm(draft);
      Router.show("confirm");
    }, 2600);
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

    // Mood guess
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

    // Theme & element guess — pick a few keyword-ish substrings
    const possibleThemes = ["逃离", "追逐", "迷路", "返回", "童年", "考试", "飞行", "旅行", "失去", "重逢", "密室", "轮回"];
    const possibleElems  = ["楼梯", "厨房", "通道", "蟑螂", "森林", "海", "灯", "雨", "镜子", "门", "钥匙", "陌生人"];

    draft.tags.themes   = possibleThemes.filter((w) => text.includes(w)).slice(0, 4);
    draft.tags.elements = possibleElems.filter((w) => text.includes(w)).slice(0, 4);

    // Summary: take up to 2 sentences from the raw text, lightly trimmed.
    const sentences = text.split(/[。.！？!?\n]/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length === 0) {
      draft.summary = text.slice(0, 80);
    } else {
      draft.summary = sentences.slice(0, 2).join("。") + (sentences.length ? "。" : "");
    }

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
    // v0.1: persist locally only. Real Sheets API replaces this later.
    State.addDream(d);
    State.clearDraft();
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

    fillReadonlyChips("#detail-themes", d.tags.themes);
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
    $("#settings-google-status").textContent = connected ? "已绑定" : "未绑定";
    $("#settings-sheet-status").textContent  = connected ? (State.getSheetName() || "Morpheus Dreams") : "尚未创建";
    $("#btn-bind-google").textContent = connected ? "重新绑定" : "绑定 Google";
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
