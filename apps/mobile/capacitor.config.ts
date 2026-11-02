import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.smartbord.capture',
  appName: 'SmartBord',
  webDir: 'dist',
  loggingBehavior: 'none',
  ios: { webContentsDebuggingEnabled: false },
  plugins: {
    CapacitorSQLite: {
      // The plugin creates/excludes this durable directory before storage is
      // initialized. Originals use this exact same Library/SmartBordVault root.
      iosDatabaseLocation: 'Library/SmartBordVault',
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};
export default config;
