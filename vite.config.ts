import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs keep the same build usable on localhost and GitHub Pages.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5200,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
