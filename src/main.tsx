import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

/**
 * An installed iOS PWA will happily serve a stale build across a reopen, which
 * makes a shipped change indistinguishable from one that was never deployed.
 * Check for a new worker on launch and whenever the app is brought back to the
 * foreground, and reload once it takes over.
 */
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === 'visible') void registration.update();
    };
    document.addEventListener('visibilitychange', check);
    window.setInterval(check, 60 * 60 * 1000);
  },
  onNeedRefresh() {
    void updateSW(true);
  },
});

// HashRouter, not BrowserRouter: GitHub Pages has no SPA rewrite, so a deep
// link or a reload on /project/123 would 404. Hash routing sidesteps that
// entirely, and the URL is invisible inside an installed PWA anyway.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
