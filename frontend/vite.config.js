import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // todo texto de interface passa por tr() (pt→en): jsx-runtime próprio em src/lib/i18n-runtime (caminho da raiz, para não virar dependência pré-empacotada)
    react({ jsxImportSource: '/src/lib/i18n-runtime' }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'masked-icon.svg', 'og-image.png', 'brand/*.svg'],
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          {
            // GET da API: rede primeiro, cai no cache quando offline (app abre sem rede)
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'genesis-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'GENESIS — Operação de torneios',
        short_name: 'GENESIS',
        description: 'Relógio de blinds, fichas, fichários, Chip Race e equipe do salão em um só lugar.',
        lang: 'pt-BR',
        theme_color: '#d10a0a',
        background_color: '#0b0d10',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: 'all',
    watch: {
      usePolling: true
    }
  }
})
