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
    proxy: {
      '/api': { target: 'http://localhost:5011', changeOrigin: true },
    },
  },
});
