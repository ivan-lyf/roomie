import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The repo's .env, shared with the API: only settings starting with VITE_ reach the browser.
  envDir: '../..',
  server: {
    proxy: {
      // Keep the Host header so the API builds model URLs on this origin.
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
    },
  },
});
