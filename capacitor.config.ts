import type { CapacitorConfig } from '@capacitor/cli';

// Native app (iPhone, iPad, and Apple-silicon Macs as "Designed for iPad"). The web app runs
// inside it from files bundled with the app; the big offline packs (rulebooks, wiki) are
// downloaded from the published site on first use, as in the web app.
const config: CapacitorConfig = {
  appId: 'io.github.dsinkwell.frreference',
  appName: 'FR Reference',
  webDir: 'dist-native', // made by scripts/native-web.mjs from dist/
  ios: {
    contentInset: 'never', // the app draws under the status bar itself (viewport-fit=cover + safe-area CSS)
    backgroundColor: '#121110',
    limitsNavigationsToAppBoundDomains: false,
    webContentsDebuggingEnabled: true, // lets Safari's Web Inspector on a Mac look inside the app (testing)
  },
};

export default config;
