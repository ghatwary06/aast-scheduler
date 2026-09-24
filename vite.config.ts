import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./src'),
  base: './',
  publicDir: here('./public'),
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { app: here('./src/app/app.html'), popup: here('./src/popup/popup.html') },
    },
  },
});
