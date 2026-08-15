import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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
