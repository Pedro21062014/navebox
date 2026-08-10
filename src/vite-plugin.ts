import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';

export interface NaveboxVitePluginOptions {
  serviceWorkerPath?: string;
  crossOriginIsolation?: boolean;
}

/** Serves the Node HTTP bridge Service Worker and configures WASM thread headers. */
export function naveboxPlugin(options: NaveboxVitePluginOptions = {}): Plugin {
  const route = options.serviceWorkerPath ?? '/navebox-sw.js';
  const isolate = options.crossOriginIsolation ?? true;
  let config: ResolvedConfig;
  const source = locateServiceWorker();

  return {
    name: 'navebox',
    config() {
      if (!isolate) return {};
      const headers = {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      };
      return { server: { headers }, preview: { headers } };
    },
    configResolved(resolved) { config = resolved; },
    configureServer(server) {
      server.middlewares.use(route, (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(readFileSync(source));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(route, (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(readFileSync(source));
      });
    },
    closeBundle() {
      if (config?.command === 'build') {
        const destination = resolve(config.root, config.build.outDir, route.replace(/^\//, ''));
        copyFileSync(source, destination);
      }
    },
  };
}

function locateServiceWorker(): string {
  const besideBuild = fileURLToPath(new URL('./navebox-sw.js', import.meta.url));
  if (existsSync(besideBuild)) return besideBuild;
  const sourceFallback = fileURLToPath(new URL('../public/navebox-sw.js', import.meta.url));
  if (existsSync(sourceFallback)) return sourceFallback;
  throw new Error('navebox-sw.js não foi encontrado no pacote.');
}

export default naveboxPlugin;
