/* App entry — wires up DOM events, recording, local parse, save. */

(function () {
  const { State, Router } = window;

  const REC_LIMIT_SEC = 180; // 3 min hard cap

  let recTimer = null;
  let recStart = 0;
  let recognition = null;
  let speechErrored = false;
  let rawText = "";
  let parseTimer = null;

  // remember the last text for parse retry
  let lastParseText = "";

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
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
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

  // ===== Home =====
  $("#btn-start-record").addEventListener("click", startRecording);
  $("#btn-empty-record")?.addEventListener("click", startRecording);

  // 直接文字输入：跳过录音，直接进确认页
  $("#btn-text-input").addEventListener("click", () => {
    const draft = freshDraft("");
    State.setDraft(draft);
    renderConfirm(draft);
    Router.show("confirm");
  });

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
    Router.show("settings");
  });
  $("#story-search").addEventListener("input", () => renderStoryList());

  // ===== Settings =====
  $("#btn-settings-back").addEventListener("click", () => Router.show("stories"));
  $("#btn-clear-all").addEventListener("click", () => {
    if (!confirm("确定要清空所有梦境记录？此操作无法撤销。")) return;
    State.clearAllDreams();
    toast("已清空", "success");
    renderStoryList();
  });

  // ===== Detail =====
  $("#btn-detail-back").addEventListener("click", () => Router.show("stories"));

  // ============================================================
  //   Recording
  // ============================================================
  function startRecording() {
    rawText = "";
    speechErrored = false;
    Router.show("recording");
    $("#rec-timer").textContent = "00:00";

    // Start timer immediately
    recStart = Date.now();
    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStart) / 1000);
      $("#rec-timer").textContent = formatMMSS(sec);
      if (sec >= REC_LIMIT_SEC) stopRecording(true);
    }, 250);

    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast("当前浏览器不支持语音识别，请手动输入", "error");
      clearInterval(recTimer);
      recTimer = null;
      setTimeout(() => {
        const draft = freshDraft("");
        State.setDraft(draft);
        renderConfirm(draft);
        Router.show("confirm");
      }, 800);
      return;
    }

    startSpeechRecognition();
  }

  // 独立出来，便于 onend 时重启
  function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalChunk += e.results[i][0].transcript;
      }
      if (finalChunk) rawText += finalChunk;
    };

    recognition.onerror = (e) => {
      if (speechErrored) return;

      // no-speech = 静默片刻，不是真正的错误，让 onend 去重启
      if (e.error === "no-speech") return;

      speechErrored = true;

      let msg;
      if (e.error === "not-allowed") {
        msg = "麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试";
      } else if (e.error === "network") {
        msg = "无法连接语音识别服务（需要翻墙或网络），已切换为手动模式";
      } else {
        msg = `语音识别出错（${e.error}），已切换为手动模式`;
      }

      toast(msg, "error");
      cleanupRecognition();
      const draft = freshDraft(rawText.trim());
      State.setDraft(draft);
      renderConfirm(draft);
      Router.show("confirm");
    };

    // Chrome 的 SpeechRecognition 即便设了 continuous，停顿后也会自动结束
    // onend 里检查如果还在录音状态就重启，保证全程持续录制
    recognition.onend = () => {
      if (recTimer !== null && !speechErrored) {
        setTimeout(() => {
          if (recTimer !== null && !speechErrored) {
            startSpeechRecognition();
          }
        }, 100);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.warn("recognition.start() failed:", e);
    }
  }

  function stopRecording(autoStopped) {
    cleanupRecognition();
    if (speechErrored) return;
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
  //   Parse (heuristic — no API key needed for v0.1)
  // ============================================================
  function goToParse(text) {
    Router.show("parsing");
    hideParseError();
    runParseSteps();

    if (!text || text.length < 5) {
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

  // Heuristic parse — extracts mood/themes/elements from text keywords
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
    d.date      = $("#f-date").value || State.todayISO();
    d.tags.mood = $("#f-mood").value;
    d.summary   = $("#f-summary").value.trim();
    d.raw       = $("#f-raw").value.trim();
    return d;
  }

  // ============================================================
  //   Save — writes directly to localStorage, no auth required
  // ============================================================
  function handleSave() {
    const d = readDraftFromForm();
    if (!d) return;
    if (!d.summary && !d.raw) {
      toast("摘要和原文都为空，写点什么吧", "error");
      return;
    }
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
