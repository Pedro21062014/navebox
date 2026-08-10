import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Connect, Plugin, ResolvedConfig } from 'vite';

export interface NaveboxVitePluginOptions {
  serviceWorkerPath?: string;
  runtimePath?: string;
  crossOriginIsolation?: boolean;
}

/**
 * Serves/copies the opaque Node runtime assets, the HTTP bridge Service Worker,
 * and configures the headers needed by WebAssembly threads.
 */
export function naveboxPlugin(options: NaveboxVitePluginOptions = {}): Plugin {
  const serviceWorkerRoute = normalizeRoute(options.serviceWorkerPath ?? '/navebox-sw.js');
  const runtimeRoute = normalizeRoute(options.runtimePath ?? '/navebox-runtime');
  const isolate = options.crossOriginIsolation ?? true;
  let config: ResolvedConfig;
  const serviceWorkerSource = locateServiceWorker();
  const runtimeDirectory = locateRuntimeDirectory();
  const esbuildWasm = locateEsbuildWasm();

  return {
    name: 'navebox',
    enforce: 'pre',
    config() {
      const headers = isolate ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      } : undefined;
      return {
        // Navebox is already compiled and contains an opaque lazy runtime.
        // Excluding it prevents optimizeDeps from parsing megabytes of kernel code.
        optimizeDeps: {
          exclude: ['@pedrobef/navebox', '@leaningtech/browserpod'],
        },
        ...(headers ? { server: { headers }, preview: { headers } } : {}),
      };
    },
    configResolved(resolved) { config = resolved; },
    configureServer(server) {
      server.middlewares.use(serviceWorkerRoute, serveFile(serviceWorkerSource, 'text/javascript; charset=utf-8'));
      server.middlewares.use(runtimeRoute, serveRuntime(runtimeDirectory, runtimeRoute, esbuildWasm));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serviceWorkerRoute, serveFile(serviceWorkerSource, 'text/javascript; charset=utf-8'));
      server.middlewares.use(runtimeRoute, serveRuntime(runtimeDirectory, runtimeRoute, esbuildWasm));
    },
    closeBundle() {
      if (config?.command !== 'build') return;
      const outputDirectory = resolve(config.root, config.build.outDir);
      mkdirSync(outputDirectory, { recursive: true });
      copyFileSync(serviceWorkerSource, resolve(outputDirectory, serviceWorkerRoute.slice(1)));
      if (!runtimeDirectory) {
        throw new Error('Runtime pré-compilado do Navebox não foi encontrado. Execute npm run build:client.');
      }
      const runtimeDestination = resolve(outputDirectory, runtimeRoute.slice(1));
      cpSync(runtimeDirectory, runtimeDestination, { recursive: true, force: true });
      copyFileSync(esbuildWasm, resolve(runtimeDestination, 'esbuild.wasm'));
    },
  };
}

function serveFile(path: string, contentType: string): Connect.NextHandleFunction {
  return (_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.end(readFileSync(path));
  };
}

function serveRuntime(root: string | undefined, route: string, esbuildWasm: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    try {
      let pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
      if (pathname.startsWith(route)) pathname = pathname.slice(route.length);
      const requested = pathname.replace(/^\/+/, '') || 'kernel.js';
      const path = requested === 'esbuild.wasm'
        ? esbuildWasm
        : root ? resolve(root, requested) : '';
      const relation = root && path !== esbuildWasm ? relative(root, path) : requested;
      if (!path || relation.startsWith('..') || relation.includes('\0') || !existsSync(path) || !statSync(path).isFile()) {
        next();
        return;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', contentType(path));
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.end(readFileSync(path));
    } catch {
      next();
    }
  };
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.js': return 'text/javascript; charset=utf-8';
    case '.wasm': return 'application/wasm';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function locateServiceWorker(): string {
  const besideBuild = moduleRelativePath('./navebox-sw.js');
  if (existsSync(besideBuild)) return besideBuild;
  const sourceFallback = moduleRelativePath('../public/navebox-sw.js');
  if (existsSync(sourceFallback)) return sourceFallback;
  throw new Error('navebox-sw.js não foi encontrado no pacote.');
}

function locateRuntimeDirectory(): string | undefined {
  const besideBuild = moduleRelativePath('./runtime');
  if (existsSync(resolve(besideBuild, 'kernel.js'))) return besideBuild;
  const sourceFallback = moduleRelativePath('../lib/runtime');
  if (existsSync(resolve(sourceFallback, 'kernel.js'))) return sourceFallback;
  return undefined;
}

function locateEsbuildWasm(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve('esbuild-wasm/esbuild.wasm');
  } catch {
    const fallback = resolve(require.resolve('esbuild-wasm/package.json'), '..', 'esbuild.wasm');
    if (existsSync(fallback)) return fallback;
    throw new Error('esbuild.wasm não foi encontrado. Reinstale esbuild-wasm.');
  }
}

function moduleRelativePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

function normalizeRoute(route: string): string {
  const normalized = `/${route.replace(/^\/+|\/+$/g, '')}`;
  if (normalized.includes('..')) throw new Error(`Rota Navebox inválida: ${route}`);
  return normalized;
}

export default naveboxPlugin;
