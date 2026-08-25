import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// основное приложение: корень домена (бывший старый кабинет — в бэкапе на сервере)
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      // наш бэкенд (hitrac-api) — на проде его отдаёт nginx как api.hitrack.am/v2
      '/v2': {
        target: 'https://api.hitrack.am',
        changeOrigin: true,
      },
      // Traccar-API (позиции, устройства)
      '/api': {
        target: 'https://api.hitrack.am',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
