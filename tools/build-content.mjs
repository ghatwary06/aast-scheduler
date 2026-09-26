// Builds the content scripts as self-contained classic scripts (chrome.scripting.executeScript files).
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
for (const name of ['reader', 'blocker']) {
  await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir: here('../dist/content'),
      emptyOutDir: false,
      lib: { entry: here(`../src/content/${name}.ts`), formats: ['iife'], name: `aast_${name}`, fileName: () => `${name}.js` },
    },
  });
}
console.log('content scripts built');
