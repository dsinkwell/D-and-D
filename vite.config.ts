import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` lets the built app live at any path (GitHub Pages sub-folder, Netlify, a NAS…).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Realms Codex',
        short_name: 'Codex',
        description: 'D&D 3.5 rules (SRD), the Forgotten Realms Wiki, and your own rulebooks — offline on Mac, iPad and iPhone.',
        theme_color: '#7a1f1f',
        background_color: '#f6f1e6',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole SRD so rules work with no connection at all.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,json,webmanifest,wasm}'],
        // The offline wiki/books databases are downloaded explicitly into OPFS, not precached.
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          {
            // Images embedded in Forgotten Realms Wiki articles.
            urlPattern: ({ url }) => url.hostname.endsWith('nocookie.net'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wiki-images',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
