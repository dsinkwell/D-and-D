// Running inside the native app (Capacitor: iPhone, iPad, Mac) or as the web app?
export const isNative = () => typeof window !== 'undefined' && (window.location.protocol === 'capacitor:' || !!(window as any).Capacitor?.isNativePlatform?.());

/** The published web app: the native app downloads the offline data packs from here. */
export const WEB_HOME = 'https://dsinkwell.github.io/D-and-D/';
