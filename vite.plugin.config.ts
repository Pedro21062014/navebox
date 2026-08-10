import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'lib',
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/vite-plugin.ts'),
      formats: ['es'],
      fileName: () => 'vite-plugin.js',
    },
    rollupOptions: {
      external: ['vite', 'node:fs', 'node:path', 'node:url', 'node:module'],
    },
  },
});
