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
    // The product SPA (served by traks-api on this same hostname for /login
    // and /portal) owns /assets/* - keep the site's hashed assets on a
    // distinct path so the zone routes can split them cleanly.
    assetsDir: 'site-assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          'framer-motion': ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5013,
    // Mirror prod topology (traks.dev/api/* -> API worker): same-origin /api.
    proxy: {
      '/api': { target: 'http://localhost:5014', changeOrigin: true },
    },
  },
});
