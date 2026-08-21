import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [react(), TanStackRouterVite()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          recharts: ['recharts'],
          'framer-motion': ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5012,
    // Mirror prod topology (traks.dev/api/* -> API worker): same-origin /api.
    // Host must be preserved (changeOrigin: false): the API derives Better
    // Auth's trustedOrigins from the request URL, so rewriting Host to :5011
    // makes every browser login fail the origin check with INVALID_ORIGIN.
    proxy: {
      // ws: the realtime dashboard socket (/api/analytics/:id/stats/realtime/ws).
      '/api': { target: 'http://localhost:5011', changeOrigin: false, ws: true },
    },
  },
});
