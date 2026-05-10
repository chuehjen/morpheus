import Native from './native.js';

const LS_KEYS = {
  dreams: 'morpheus.dreams.cache.v1',
  google: 'morpheus.google.connected.v1',
  sheet: 'morpheus.sheet.id.v1',
  draft: 'morpheus.draft.v1',
  settings: 'morpheus.settings.v1',
};

function sortDreamsDesc(list) {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function normalizeDream(entry) {
  return {
    id: entry.id || State.newId(),
    date: entry.date || State.todayISO(),
    tags: {
      mood: entry?.tags?.mood || '奇幻',
      themes: Array.isArray(entry?.tags?.themes) ? entry.tags.themes.slice(0, 4) : [],
      elements: Array.isArray(entry?.tags?.elements) ? entry.tags.elements.slice(0, 4) : [],
    },
    summary: entry.summary || '',
    raw: entry.raw || '',
  };
}

const State = {
  _draft: null,
  _dreams: null,
  _initialized: false,

  async ensureReady() {
    if (this._initialized) return;

    const storedDreams = await Native.storageGet(LS_KEYS.dreams);
    if (Array.isArray(storedDreams)) {
      this._dreams = storedDreams.map(normalizeDream);
    } else {
      this._dreams = [];
      await Native.storageSet(LS_KEYS.dreams, this._dreams);
    }

    this._draft = (await Native.storageGet(LS_KEYS.draft)) || null;
    this._initialized = true;
  },

  async getDreams() {
    await this.ensureReady();
    return sortDreamsDesc(this._dreams);
  },

  async getDream(id) {
    await this.ensureReady();
    return this._dreams.find((d) => d.id === id) || null;
  },

  async addDream(entry) {
    await this.ensureReady();
    const normalized = normalizeDream(entry);
    this._dreams.unshift(normalized);
    this._dreams = sortDreamsDesc(this._dreams);
    await Native.storageSet(LS_KEYS.dreams, this._dreams);
    return normalized;
  },

  async clearAllDreams() {
    await this.ensureReady();
    this._dreams = [];
    await Native.storageSet(LS_KEYS.dreams, []);
  },


  async setDraft(d) {
    await this.ensureReady();
    this._draft = d || null;
    if (d) {
      await Native.storageSet(LS_KEYS.draft, d);
    } else {
      await Native.storageRemove(LS_KEYS.draft);
    }
  },

  async getDraft() {
    await this.ensureReady();
    return this._draft;
  },

  async clearDraft() {
    await this.setDraft(null);
  },

  async isGoogleConnected() {
    return !!(await Native.storageGet(LS_KEYS.google));
  },

  async setGoogleConnected(v) {
    if (v) await Native.storageSet(LS_KEYS.google, 1);
    else await Native.storageRemove(LS_KEYS.google);
  },

  async getSheetName() {
    return (await this.isGoogleConnected()) ? 'Morpheus Dreams' : null;
  },

  async getSettings() {
    return (
      (await Native.storageGet(LS_KEYS.settings)) || {
        reminderEnabled: false,
        reminderHour: 7,
        reminderMinute: 0,
        language: 'zh-CN',
      }
    );
  },

  async setSettings(patch) {
    const next = { ...(await this.getSettings()), ...patch };
    await Native.storageSet(LS_KEYS.settings, next);
    return next;
  },

  todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  newId() {
    return 'd-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6);
  },
};

window.State = State;
export default State;
