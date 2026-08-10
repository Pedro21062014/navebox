export {};

declare global {
  interface Window {
    __esbuild?: typeof import('esbuild-wasm');
    __esbuildInitPromise?: Promise<void>;
  }
}
