import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards frontend calls to relative /api/* paths straight to the
    // backend during dev, so the browser never sees cross-origin requests
    // and the backend needs no CORS config. Dev-only: in production, Express
    // serves the built app (frontend/dist) and the API from one origin, so no
    // proxy is needed (see frontend/README.md).
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
