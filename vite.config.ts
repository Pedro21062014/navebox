import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'lib',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'navebox.js',
      cssFileName: 'navebox',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'esbuild-wasm', '@leaningtech/browserpod'],
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((name) => name.endsWith('.wasm'))) {
            return 'assets/[name][extname]';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
