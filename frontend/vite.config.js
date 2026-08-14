import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards frontend calls to relative /api/* paths straight to the
    // backend during dev, so the browser never sees cross-origin requests
    // and the backend needs no CORS config. Dev-only — see frontend/README.md
    // for how this needs to be replaced (a real base URL, or a proxy on the
    // production host) once this ships anywhere.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
