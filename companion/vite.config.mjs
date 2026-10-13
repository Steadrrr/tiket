import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: true },
});
