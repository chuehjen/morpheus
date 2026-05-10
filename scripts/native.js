import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';

const REMINDER_NOTIFICATION_ID = 1001;

const Native = {
  isNativeApp() {
    return Capacitor.isNativePlatform();
  },

  isWeb() {
    return !Capacitor.isNativePlatform();
  },

  async requestSpeechPermission() {
    try {
      const result = await SpeechRecognition.requestPermissions();
      return result?.speechRecognition === 'granted';
    } catch (error) {
      console.error('[Native] requestSpeechPermission failed', error);
      return false;
    }
  },

  async hasSpeechPermission() {
    try {
      const result = await SpeechRecognition.checkPermissions();
      return result?.speechRecognition === 'granted';
    } catch (error) {
      console.error('[Native] hasSpeechPermission failed', error);
      return false;
    }
  },

  async startListening({ language = 'zh-CN', onPartial, onFinal, onError } = {}) {
    try {
      await SpeechRecognition.removeAllListeners();

      SpeechRecognition.addListener('partialResults', ({ matches }) => {
        const text = Array.isArray(matches) ? matches[0] || '' : '';
        if (text && typeof onPartial === 'function') onPartial(text);
      });

      SpeechRecognition.addListener('results', ({ matches }) => {
        const text = Array.isArray(matches) ? matches[0] || '' : '';
        if (text && typeof onFinal === 'function') onFinal(text);
      });

      await SpeechRecognition.start({
        language,
        maxResults: 1,
        prompt: '请说出你的梦境……',
        partialResults: true,
        popup: false,
      });
    } catch (error) {
      console.error('[Native] startListening failed', error);
      if (typeof onError === 'function') {
        onError(error?.message || 'start_failed');
      }
    }
  },

  async stopListening() {
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
      try {
        await SpeechRecognition.removeAllListeners();
      } catch (_) {}
      return '';
    }
  },

  async storageGet(key) {
    try {
      const { value } = await Preferences.get({ key });
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      console.error('[Native] storageGet failed', key, error);
      return null;
    }
  },

  async storageSet(key, value) {
    try {
      await Preferences.set({ key, value: JSON.stringify(value) });
      return true;
    } catch (error) {
      console.error('[Native] storageSet failed', key, error);
      return false;
    }
  },

  async storageRemove(key) {
    try {
      await Preferences.remove({ key });
      return true;
    } catch (error) {
      console.error('[Native] storageRemove failed', key, error);
      return false;
    }
  },

  async requestNotificationPermission() {
    try {
      const result = await LocalNotifications.requestPermissions();
      return result?.display === 'granted';
    } catch (error) {
      console.error('[Native] requestNotificationPermission failed', error);
      return false;
    }
  },

  async scheduleDailyReminder(hour = 7, minute = 0) {
    try {
      const granted = await this.requestNotificationPermission();
      if (!granted) return false;

      await LocalNotifications.cancel({
        notifications: [{ id: REMINDER_NOTIFICATION_ID }],
      });

      await LocalNotifications.schedule({
        notifications: [
          {
            id: REMINDER_NOTIFICATION_ID,
            title: 'Morpheus',
            body: '早安，记录你刚才的梦境吧 🌙',
            schedule: {
              on: { hour, minute },
              repeats: true,
              allowWhileIdle: true,
            },
            sound: null,
            actionTypeId: '',
          },
        ],
      });

      return true;
    } catch (error) {
      console.error('[Native] scheduleDailyReminder failed', error);
      return false;
    }
  },

  async cancelDailyReminder() {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: REMINDER_NOTIFICATION_ID }],
      });
      return true;
    } catch (error) {
      console.error('[Native] cancelDailyReminder failed', error);
      return false;
    }
  },
};

window.Native = Native;
export default Native;
