// ============================================================
// Capacitor modules — loaded lazily, only inside native shell.
// Static bare-specifier imports crash the browser module graph
// on any non-Vite environment (GitHub Pages, plain HTTP server).
// Instead we probe window.Capacitor (injected by the native
// bridge) and dynamically import only when actually native.
// ============================================================
let Capacitor = { isNativePlatform: () => false, isPluginAvailable: () => false };
let SpeechRecognition = {};
let LocalNotifications = {};
let Preferences = {};

if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
  try {
    ({ Capacitor } = await import('@capacitor/core'));
    ({ SpeechRecognition } = await import('@capacitor-community/speech-recognition'));
    ({ LocalNotifications } = await import('@capacitor/local-notifications'));
    ({ Preferences } = await import('@capacitor/preferences'));
  } catch (e) {
    console.warn('[Native] Failed to load Capacitor modules:', e.message);
  }
}

const REMINDER_NOTIFICATION_ID = 1001;

/** Detect whether running inside a Capacitor native shell. */
function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/* ============================================================
   Web Speech API fallback (for plain browser / Vite dev server)
   ============================================================ */
const WebSpeech = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  let recognition = null;
  let onPartial = null;
  let onFinal = null;
  let onErr = null;

  return {
    async start({ language = 'zh-CN', onPartial: op, onFinal: of, onError: oe }) {
      onPartial = op; onFinal = of; onErr = oe;
      recognition = new SR();
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            if (of) of(t);
          } else {
            interim += t;
          }
        }
        if (interim && op) op(interim);
      };
      recognition.onerror = (e) => {
        if (oe) oe(e.error);
      };
      recognition.start();
    },

    async stop() {
      if (!recognition) return '';
      return new Promise((resolve) => {
        recognition.onresult = (e) => {
          let final = '';
          for (let i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript;
          }
          resolve(final);
        };
        recognition.onend = () => resolve('');
        recognition.stop();
        recognition = null;
      });
    },

    requestPermissions() {
      // Web Speech API has no explicit permission flow; it prompts on start().
      return true;
    },

    checkPermissions() {
      return true;
    },
  };
})();

/* LocalStorage shim */
const LsStorage = {
  async get(key) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return null;
      return JSON.parse(v);
    } catch { return null; }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch { return false; }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch { return false; }
  },
};

/* ============================================================
   Unified Native API
   ============================================================ */
const Native = {
  isNativeApp() {
    return isNative();
  },

  isWeb() {
    return !isNative();
  },

  async requestSpeechPermission() {
    if (isNative()) {
      try {
        const result = await SpeechRecognition.requestPermissions();
        return result?.speechRecognition === 'granted';
      } catch (error) {
        console.error('[Native] requestSpeechPermission failed', error);
        return false;
      }
    }
    // Web: no explicit permission needed
    return WebSpeech ? WebSpeech.requestPermissions() : false;
  },

  async hasSpeechPermission() {
    if (isNative()) {
      try {
        const result = await SpeechRecognition.checkPermissions();
        return result?.speechRecognition === 'granted';
      } catch { return false; }
    }
    return WebSpeech ? WebSpeech.checkPermissions() : false;
  },

  async startListening(opts = {}) {
    if (isNative()) {
      try {
        await SpeechRecognition.removeAllListeners();
        SpeechRecognition.addListener('partialResults', ({ matches }) => {
          const text = Array.isArray(matches) ? matches[0] || '' : '';
          if (text && typeof opts.onPartial === 'function') opts.onPartial(text);
        });
        SpeechRecognition.addListener('results', ({ matches }) => {
          const text = Array.isArray(matches) ? matches[0] || '' : '';
          if (text && typeof opts.onFinal === 'function') opts.onFinal(text);
        });
        await SpeechRecognition.start({
          language: opts.language || 'zh-CN',
          maxResults: 1,
          prompt: '请说出你的梦境……',
          partialResults: true,
          popup: false,
        });
      } catch (error) {
        console.error('[Native] startListening failed', error);
        if (typeof opts.onError === 'function') opts.onError(error?.message || 'start_failed');
      }
      return;
    }

    // Web fallback
    if (WebSpeech) {
      try {
        await WebSpeech.start({
          language: opts.language || 'zh-CN',
          onPartial: opts.onPartial,
          onFinal: opts.onFinal,
          onError: opts.onError,
        });
      } catch (error) {
        if (typeof opts.onError === 'function') opts.onError(error?.message || 'web_speech_failed');
      }
    } else {
      if (typeof opts.onError === 'function') opts.onError('speech_not_supported');
    }
  },

  async stopListening() {
    if (isNative()) {
      try {
        const result = await SpeechRecognition.stop();
        await SpeechRecognition.removeAllListeners();
        if (typeof result === 'string') return result;
        if (Array.isArray(result?.matches)) return result.matches[0] || '';
        if (typeof result?.text === 'string') return result.text;
        if (typeof result?.value === 'string') return result.value;
        return '';
      } catch (error) {
        console.error('[Native] stopListening failed', error);
        try { await SpeechRecognition.removeAllListeners(); } catch (_) {}
        return '';
      }
    }
    // Web fallback
    return WebSpeech ? WebSpeech.stop() : '';
  },

  async storageGet(key) {
    if (isNative()) {
      try {
        const { value } = await Preferences.get({ key });
        if (!value) return null;
        return JSON.parse(value);
      } catch (error) {
        console.error('[Native] storageGet failed', key, error);
        return null;
      }
    }
    return LsStorage.get(key);
  },

  async storageSet(key, value) {
    if (isNative()) {
      try {
        await Preferences.set({ key, value: JSON.stringify(value) });
        return true;
      } catch (error) {
        console.error('[Native] storageSet failed', key, error);
        return false;
      }
    }
    return LsStorage.set(key, value);
  },

  async storageRemove(key) {
    if (isNative()) {
      try {
        await Preferences.remove({ key });
        return true;
      } catch (error) {
        console.error('[Native] storageRemove failed', key, error);
        return false;
      }
    }
    return LsStorage.remove(key);
  },

  async requestNotificationPermission() {
    if (isNative()) {
      try {
        const result = await LocalNotifications.requestPermissions();
        return result?.display === 'granted';
      } catch { return false; }
    }
    // Browser: use Notification API
    if ('Notification' in window) {
      const r = await Notification.requestPermission();
      return r === 'granted';
    }
    return false;
  },

  async scheduleDailyReminder(hour = 7, minute = 0) {
    if (isNative()) {
      try {
        const granted = await this.requestNotificationPermission();
        if (!granted) return false;
        await LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIFICATION_ID }] });
        await LocalNotifications.schedule({
          notifications: [{
            id: REMINDER_NOTIFICATION_ID,
            title: 'Morpheus',
            body: '早安，记录你刚才的梦境吧 🌙',
            schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
            sound: null,
            actionTypeId: '',
          }],
        });
        return true;
      } catch { return false; }
    }
    // Browser: simple notification API (no scheduled repeat support)
    const granted = await this.requestNotificationPermission();
    if (!granted) return false;
    console.log(`[Native] Browser mode: reminders would fire at ${hour}:${minute} (scheduled via service worker in future)`);
    return true;
  },

  async cancelDailyReminder() {
    if (isNative()) {
      try {
        await LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIFICATION_ID }] });
        return true;
      } catch { return false; }
    }
    return true;
  },
};

window.Native = Native;
export default Native;
