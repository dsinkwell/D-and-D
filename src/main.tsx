import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { whenIdle } from './lib/busy';
import { cleanupLabStorage } from './lib/cleanup';
import './styles.css';

// A new version installs in the background; the page switches to it only when no download or
// model work is running, so updates never interrupt them. Both steps wait: activating the new
// version, and the reload once it has taken over (work may have started in between).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('[update] new version waiting; will switch when idle');
    whenIdle().then(() => updateSW());
  },
  onNeedReload() {
    whenIdle().then(() => window.location.reload());
  },
});

// free space left by the removed AI test page, once, a little after start-up
setTimeout(() => void cleanupLabStorage(), 5000);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
