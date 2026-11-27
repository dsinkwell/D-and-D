import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` lets the built app live at any path (GitHub Pages sub-folder, Netlify, a NAS…).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // applied by src/main.tsx when nothing is busy
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: '3.5 Forgotten Realms Reference',
        short_name: 'FR Reference',
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
        // The Ask model/runtime (~47 MB) is opt-in: downloaded from the Ask page into its own cache.
        globIgnores: ['data/**', 'models/**', 'ort/**', 'ask/**'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//, /\/models\//, /\/ort\//, /\/ask\//],
        runtimeCaching: [
          {
            // Ask: model, ONNX runtime and SRD meaning index, stored by downloadAsk() in this cache.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(models|ort|ask)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'ask-models', cacheableResponse: { statuses: [200] }, matchOptions: { ignoreVary: true } },
          },
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
  resolve: {
    // the plain WebAssembly build of ONNX Runtime (11 MB) instead of the WebGPU/JSEP one (23 MB)
    alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
  },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
