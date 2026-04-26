import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4400,
    proxy: {
      '/api': {
        target: 'http://localhost:4500',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:4500',
        ws: true,
      },
    },
  },
});
