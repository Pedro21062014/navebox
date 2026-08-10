import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Build the Node compatibility kernel as opaque, precompiled runtime assets.
 * Consumer bundlers copy these files instead of parsing/rebundling the kernel.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'lib/runtime',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    minify: 'esbuild',
    lib: {
      entry: resolve(import.meta.dirname, 'src/kernel/index.ts'),
      formats: ['es'],
      fileName: () => 'kernel.js',
    },
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
