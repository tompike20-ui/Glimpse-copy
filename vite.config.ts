import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/Glimpse-copy/
const BASE = '/Glimpse-copy/';

/**
 * A visible build stamp, so "am I actually running the new version?" is a
 * question the app can answer rather than one that needs a maintainer.
 * Service workers on iOS can serve a stale build across a reopen, and without
 * this there is no way to tell that from a change that was never deployed.
 */
function buildId(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return sha;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      // The ffmpeg core is ~31 MB. Precaching it would make first install
      // punishing on cellular, so it is runtime-cached on first export
      // instead — after which offline export works.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['vendor/**', 'spike/**'],
        navigateFallbackDenylist: [/^\/Glimpse-copy\/spike/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/vendor/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ffmpeg-core',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Glimpse',
        short_name: 'Glimpse',
        description: 'Capture moments, build one growing video.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0b0c',
        theme_color: '#0b0b0c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
