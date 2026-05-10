import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.morpheus.dreamjournal',
  appName: 'Morpheus',
  webDir: 'dist',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#F5F1E8',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_moon',
      iconColor: '#C4A882',
    },
  },
};

export default config;
