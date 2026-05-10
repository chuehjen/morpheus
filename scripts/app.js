import Native from './native.js';
import State from './state.js';

(function () {
  const { Router } = window;
  const REC_LIMIT_SEC = 180;

  let recTimer = null;
  let recStart = 0;
  let rawText = '';
  let parseTimer = null;
  let lastParseText = '';
  let isStoppingRecording = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg, kind) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.hidden = true;
    }, 3000);
  }

  function syncNetBanner() {
    const banner = $('#net-banner');
    if (!banner) return;
    banner.hidden = navigator.onLine || Native.isNativeApp();
  }

  async function init() {
    bindEvents();
    syncNetBanner();
    window.addEventListener('online', syncNetBanner);
    window.addEventListener('offline', syncNetBanner);
    await State.ensureReady();
  }

  function bindEvents() {
    document.addEventListener('click', async (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const target = tab.dataset.tabTarget;
      if (target === 'stories') await renderStoryList();
      Router.show(target);
    });

    $('#btn-start-record')?.addEventListener('click', () => void startRecording());
    $('#btn-empty-record')?.addEventListener('click', () => void startRecording());
    $('#btn-text-input')?.addEventListener('click', () => void openTextInput());

    $('#btn-stop-record')?.addEventListener('click', () => void stopRecording(false));
    $('#btn-cancel-record')?.addEventListener('click', () => void cancelRecording());

    $('#btn-parse-retry')?.addEventListener('click', () => {
      hideParseError();
      runParseSteps();
      finishParse(lastParseText);
    });
    $('#btn-parse-manual')?.addEventListener('click', () => void openManualConfirmFromParse());

    $('#btn-confirm-back')?.addEventListener('click', () => Router.show('home'));
    $('#btn-redo')?.addEventListener('click', () => void redoRecording());
    $('#btn-save')?.addEventListener('click', () => void handleSave());
    bindChipInput('#input-theme', 'themes', '#chips-themes');
    bindChipInput('#input-element', 'elements', '#chips-elements');

    $('#btn-go-stories')?.addEventListener('click', () => void goStories());
    $('#btn-go-home')?.addEventListener('click', () => Router.show('home'));

    $('#btn-open-settings')?.addEventListener('click', () => Router.show('settings'));
    $('#story-search')?.addEventListener('input', () => void renderStoryList());

    $('#btn-settings-back')?.addEventListener('click', () => Router.show('stories'));
    $('#btn-clear-all')?.addEventListener('click', () => void clearAllDreams());

    $('#btn-detail-back')?.addEventListener('click', () => Router.show('stories'));
  }

  async function openTextInput() {
    const draft = freshDraft('');
    await State.setDraft(draft);
    renderConfirm(draft);
    Router.show('confirm');
    setTimeout(() => $('#f-raw')?.focus(), 100);
  }

  async function startRecording() {
    rawText = '';
    isStoppingRecording = false;
    Router.show('recording');
    if ($('#rec-timer')) $('#rec-timer').textContent = '00:00';

    const granted = await Native.requestSpeechPermission();
    if (!granted) {
      toast('请在 iPhone 设置中允许 Morpheus 使用语音识别与麦克风', 'error');
      await openTextInput();
      return;
    }

    recStart = Date.now();
    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStart) / 1000);
      if ($('#rec-timer')) $('#rec-timer').textContent = formatMMSS(sec);
      if (sec >= REC_LIMIT_SEC) void stopRecording(true);
    }, 250);

    await Native.startListening({
      language: 'zh-CN',
      onPartial: (text) => {
        rawText = text || rawText;
      },
      onFinal: (text) => {
        rawText = text || rawText;
      },
      onError: async (code) => {
        cleanupRecordingTimer();
        toast(`语音识别出错（${code}），已切换为手动输入`, 'error');
        const draft = freshDraft(rawText.trim());
        await State.setDraft(draft);
        renderConfirm(draft);
        Router.show('confirm');
      },
    });
  }

  async function stopRecording(autoStopped = false) {
    if (isStoppingRecording) return;
    isStoppingRecording = true;

    cleanupRecordingTimer();
    if (autoStopped) toast('已达 3 分钟上限，自动停止', '');

    const finalText = await Native.stopListening();
    rawText = (finalText || rawText || '').trim();
    isStoppingRecording = false;
    goToParse(rawText);
  }

  async function cancelRecording() {
    cleanupRecordingTimer();
    rawText = '';
    try {
      await Native.stopListening();
    } catch (_) {}
    Router.show('home');
  }

  function cleanupRecordingTimer() {
    if (recTimer) {
      clearInterval(recTimer);
      recTimer = null;
    }
  }

  function formatMMSS(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatDate(value) {
    if (!value) return '';
    return String(value).replace(/-/g, '.');
  }

  function goToParse(text) {
    Router.show('parsing');
    hideParseError();
    runParseSteps();

    if (!text || text.length < 5) {
      setTimeout(async () => {
        clearParseSteps();
        const draft = freshDraft(text || '');
        await State.setDraft(draft);
        renderConfirm(draft);
        Router.show('confirm');
        if (text) toast('录音内容很短，请手动补充', '');
      }, 1400);
      return;
    }

    finishParse(text);
  }

  function finishParse(text) {
    lastParseText = text;
    setTimeout(async () => {
      clearParseSteps();
      const draft = mockParse(text);
      await State.setDraft(draft);
      renderConfirm(draft);
      Router.show('confirm');
    }, 2400);
  }

  function showParseError() {
    $('#parse-steps') && ($('#parse-steps').hidden = true);
    $('#parse-error') && ($('#parse-error').hidden = false);
  }

  function hideParseError() {
    $('#parse-error') && ($('#parse-error').hidden = true);
    $('#parse-steps') && ($('#parse-steps').hidden = false);
  }

  function runParseSteps() {
    const items = $$('#parse-steps li');
    items.forEach((li) => li.classList.remove('is-active', 'is-done'));
    let i = 0;
    const tick = () => {
      if (i > 0) items[i - 1].classList.replace('is-active', 'is-done');
      if (i < items.length) {
        items[i].classList.add('is-active');
        i += 1;
        parseTimer = setTimeout(tick, 600);
      }
    };
    tick();
  }

  function clearParseSteps() {
    if (parseTimer) {
      clearTimeout(parseTimer);
      parseTimer = null;
    }
    $$('#parse-steps li').forEach((li) => {
      li.classList.remove('is-active');
      li.classList.add('is-done');
    });
  }

  function freshDraft(text) {
    return {
      id: State.newId(),
      date: State.todayISO(),
      tags: {
        mood: '奇幻',
        themes: [],
        elements: [],
      },
      summary: '',
      raw: text || '',
    };
  }

  function mockParse(text) {
    const draft = freshDraft(text);
    const moodHits = [
      { mood: '恐怖/惊悚', words: ['恐怖', '惊悚', '蟑螂', '鬼', '尸', '黑暗'] },
      { mood: '焦虑', words: ['追', '迟到', '考试', '找不到', '晚了', '丢'] },
      { mood: '温暖', words: ['家人', '外婆', '祖母', '厨房', '阳光', '笑'] },
      { mood: '悲伤', words: ['哭', '离别', '走了', '葬礼'] },
      { mood: '奇幻', words: ['飞', '魔法', '城堡', '森林', '龙', '异世界'] },
      { mood: '平静', words: ['海', '湖', '雨', '安静'] },
    ];

    for (const m of moodHits) {
      if (m.words.some((w) => text.includes(w))) {
        draft.tags.mood = m.mood;
        break;
      }
    }

    const possibleThemes = ['逃离', '追逐', '迷路', '返回', '童年', '考试', '飞行', '旅行', '失去', '重逢', '密室', '轮回'];
    const possibleElems = ['楼梯', '厨房', '通道', '蟑螂', '森林', '海', '灯', '雨', '镜子', '门', '钥匙', '陌生人'];
    draft.tags.themes = possibleThemes.filter((w) => text.includes(w)).slice(0, 4);
    draft.tags.elements = possibleElems.filter((w) => text.includes(w)).slice(0, 4);

    const sentences = text
      .split(/[。.！？!?\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    draft.summary = sentences.length === 0 ? text.slice(0, 80) : sentences.slice(0, 2).join('。') + '。';
    return draft;
  }

  function renderConfirm(d) {
    $('#f-date') && ($('#f-date').value = d.date);
    $('#f-mood') && ($('#f-mood').value = d.tags.mood || '奇幻');
    $('#f-summary') && ($('#f-summary').value = d.summary || '');
    $('#f-raw') && ($('#f-raw').value = d.raw || '');
    renderChips('#chips-themes', d.tags.themes, 'themes');
    renderChips('#chips-elements', d.tags.elements, 'elements');
  }

  function renderChips(sel, list, kind) {
    const wrap = $(sel);
    if (!wrap) return;
    wrap.innerHTML = '';
    (list || []).forEach((label, idx) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = label;

      const x = document.createElement('button');
      x.className = 'chip__x';
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', '删除');
      x.addEventListener('click', async () => {
        const draft = await State.getDraft();
        if (!draft) return;
        draft.tags[kind].splice(idx, 1);
        await State.setDraft(draft);
        renderChips(sel, draft.tags[kind], kind);
      });

      chip.appendChild(x);
      wrap.appendChild(chip);
    });
  }

  function bindChipInput(inputSel, kind, listSel) {
    const inp = $(inputSel);
    if (!inp) return;
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const draft = await State.getDraft();
      if (!draft) return;
      if (!draft.tags[kind].includes(v)) {
        draft.tags[kind].push(v);
        await State.setDraft(draft);
        renderChips(listSel, draft.tags[kind], kind);
      }
      inp.value = '';
    });
  }

  async function readDraftFromForm() {
    const d = await State.getDraft();
    if (!d) return null;
    d.date = $('#f-date')?.value || State.todayISO();
    d.tags.mood = $('#f-mood')?.value || '奇幻';
    d.summary = $('#f-summary')?.value?.trim() || '';
    d.raw = $('#f-raw')?.value?.trim() || '';
    await State.setDraft(d);
    return d;
  }

  async function handleSave() {
    const d = await readDraftFromForm();
    if (!d) return;
    if (!d.summary && !d.raw) {
      toast('摘要和原文都为空，写点什么吧', 'error');
      return;
    }
    await State.addDream(d);
    await State.clearDraft();
    Router.show('saved');
  }

  function fillReadonlyChips(selector, items) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = '';

    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) {
      root.textContent = '—';
      return;
    }

    values.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item;
      root.appendChild(chip);
    });
  }

  async function renderStoryList() {
    const list = await State.getDreams();
    const q = ($('#story-search')?.value || '').trim().toLowerCase();
    const filtered = q
      ? list.filter((d) => {
          const hay = [
            d.summary,
            d.raw,
            d.tags?.mood,
            ...(d.tags?.themes || []),
            ...(d.tags?.elements || []),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
      : list;

    const wrap = $('#story-list');
    const empty = $('#story-empty');
    if (!wrap || !empty) return;

    wrap.innerHTML = '';
    if (filtered.length === 0) {
      empty.hidden = false;
      wrap.hidden = true;
      return;
    }

    empty.hidden = true;
    wrap.hidden = false;

    filtered.forEach((d) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'story-card';
      card.innerHTML = `
        <div class="story-card__date">${escapeHTML(formatDate(d.date || ''))}</div>
        <div class="story-card__summary">${escapeHTML(d.summary || d.raw || '未命名梦境')}</div>
        <div class="story-card__tags">${(d.tags?.themes || []).slice(0, 4).map((t) => `<span class="story-card__tag">${escapeHTML(t)}</span>`).join('')}</div>
      `;
      card.addEventListener('click', () => void openDetail(d.id));
      wrap.appendChild(card);
    });
  }

  async function openDetail(id) {
    const d = await State.getDream(id);
    if (!d) return;
    $('#detail-date') && ($('#detail-date').textContent = formatDate(d.date || ''));
    $('#detail-mood') && ($('#detail-mood').textContent = d.tags?.mood || '');
    fillReadonlyChips('#detail-themes', d.tags?.themes || []);
    fillReadonlyChips('#detail-elements', d.tags?.elements || []);
    $('#detail-summary') && ($('#detail-summary').textContent = d.summary || '');
    $('#detail-raw') && ($('#detail-raw').textContent = d.raw || '');
    Router.show('storyDetail');
  }

  async function clearAllDreams() {
    if (!window.confirm('确定要清空所有梦境记录？此操作无法撤销。')) return;
    await State.clearAllDreams();
    toast('已清空', 'success');
    await renderStoryList();
  }

  async function redoRecording() {
    await State.clearDraft();
    await startRecording();
  }

  async function goStories() {
    await renderStoryList();
    Router.show('stories');
  }

  async function openManualConfirmFromParse() {
    hideParseError();
    const draft = freshDraft(lastParseText);
    await State.setDraft(draft);
    renderConfirm(draft);
    Router.show('confirm');
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  void init();
})();
