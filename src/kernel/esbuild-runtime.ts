import * as esbuild from 'esbuild-wasm';

export const LOCAL_ESBUILD_WASM_URL = '/navebox-runtime/esbuild.wasm';

let initialization: Promise<typeof esbuild> | null = null;

/** Shared, local esbuild runtime used by npm transforms, Vite and Next adapters. */
export async function getEsbuildRuntime(wasmUrl = LOCAL_ESBUILD_WASM_URL): Promise<typeof esbuild> {
  if (typeof window !== 'undefined' && window.__esbuild) return window.__esbuild;
  if (initialization) return initialization;

  initialization = (async () => {
    try {
      await esbuild.initialize({ wasmURL: wasmUrl, worker: true });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('initialize')) throw error;
    }
    if (typeof window !== 'undefined') window.__esbuild = esbuild;
    return esbuild;
  })().catch((error) => {
    initialization = null;
    if (typeof window !== 'undefined') window.__esbuildInitPromise = undefined;
    throw error;
  });

  if (typeof window !== 'undefined') {
    window.__esbuildInitPromise = initialization.then(() => undefined);
  }
  return initialization;
}
