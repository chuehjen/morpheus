/* In-memory + localStorage state for v0.1.
   Real Sheets/OAuth integration replaces these reads/writes later. */

(function () {
  const LS_KEYS = {
    dreams: "morpheus.dreams.cache.v1",
    google: "morpheus.google.connected.v1",
    sheet:  "morpheus.sheet.id.v1",
    debug:  "morpheus.debug.fail.v1"
  };

  // current dream being edited on the confirm screen
  let draft = null;

  function loadDreams() {
    try {
      const raw = localStorage.getItem(LS_KEYS.dreams);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    // No mock seed on first run — empty list shows the empty-state UI.
    return [];
  }

  function persistDreams(list) {
    try {
      localStorage.setItem(LS_KEYS.dreams, JSON.stringify(list));
    } catch (_) {}
  }

  let dreams = loadDreams();

  const State = {
    // ----- dreams -----
    getDreams() {
      return [...dreams].sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getDream(id) {
      return dreams.find((d) => d.id === id) || null;
    },
    addDream(entry) {
      dreams.unshift(entry);
      persistDreams(dreams);
    },
    /** Replace the current list with the bundled mock entries. */
    loadDemoData() {
      if (Array.isArray(window.MOCK_DREAMS)) {
        dreams = [...window.MOCK_DREAMS];
        persistDreams(dreams);
      }
    },
    clearAllDreams() {
      dreams = [];
      persistDreams(dreams);
    },

    // ----- draft (in-memory only) -----
    setDraft(d) { draft = d; },
    getDraft()  { return draft; },
    clearDraft() { draft = null; },

    // ----- Google bind status (mocked for v0.1) -----
    isGoogleConnected() {
      return localStorage.getItem(LS_KEYS.google) === "1";
    },
    setGoogleConnected(v) {
      if (v) localStorage.setItem(LS_KEYS.google, "1");
      else localStorage.removeItem(LS_KEYS.google);
    },
    getSheetName() {
      return this.isGoogleConnected() ? "Morpheus Dreams" : null;
    },

    // ----- Debug fail toggle (used to test parse/save failure UIs) -----
    isDebugFail() {
      return localStorage.getItem(LS_KEYS.debug) === "1";
    },
    setDebugFail(v) {
      if (v) localStorage.setItem(LS_KEYS.debug, "1");
      else localStorage.removeItem(LS_KEYS.debug);
    },

    // ----- helpers -----
    todayISO() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    },
    newId() {
      return "d-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6);
    }
  };

  window.State = State;
})();
