import https from 'node:https';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Только для локального превью мобильной версии: основной конфиг проксирует
// лишь /api, а клиент ходит в /v2. IPv6-выхода в этой сети нет, поэтому
// агент прибит к IPv4 — иначе Node виснет на AAAA и vite отдаёт 500.
const agent = new https.Agent({ family: 4, autoSelectFamily: false, keepAlive: true });
const proxy = { target: 'https://api.hitrack.am', changeOrigin: true, ws: true, agent };

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5199,
    proxy: { '/v2': proxy, '/api': proxy },
  },
});
