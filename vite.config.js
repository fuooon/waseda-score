import { defineConfig } from 'vite';

export default defineConfig({
  // base: '/waseda-score/',
  root: '.',
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
