import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';
const wsTarget = process.env.VITE_WS_PROXY_TARGET || 'ws://127.0.0.1:8000';

const proxyConfig = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
  '/ws': {
    target: wsTarget,
    ws: true,
    changeOrigin: true,
  },
  '/health': {
    target: apiTarget,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: proxyConfig,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    proxy: proxyConfig,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
