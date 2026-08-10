import * as esbuild from 'esbuild-wasm';
import { dirname, extname, normalizePath } from './path';
import type {
  BuildArtifact,
  BuildProgress,
  CompilerOptions,
  NaveboxFramework,
  PackageManifest,
  VirtualFile,
} from './types';
import { VirtualFileSystem } from './virtual-file-system';

let initializePromise: Promise<void> | null = null;

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css'];
const LOCAL_STYLESHEET = /<link\b(?=[^>]*rel=["']stylesheet["'])(?=[^>]*href=["'](?:\.?\.?\/|\/)[^"']+["'])[^>]*>/gi;
const MODULE_SCRIPT = /<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/gi;

interface PreparedProject {
  files: Map<string, string>;
  framework: NaveboxFramework;
  entryPoint: string;
  baseHtml: string;
  manifest: PackageManifest;
}

export class BrowserCompiler {
  private readonly cdnBaseUrl: string;
  private readonly wasmUrl: string;
  private readonly development: boolean;

  constructor(options: CompilerOptions = {}) {
    this.cdnBaseUrl = (options.cdnBaseUrl ?? 'https://esm.sh').replace(/\/$/, '');
    this.wasmUrl = options.wasmUrl ?? '/navebox-runtime/esbuild.wasm';
    this.development = options.development ?? true;
  }

  async compile(
    fileSystem: VirtualFileSystem,
    channel = 'navebox-preview',
    onProgress?: (progress: BuildProgress) => void,
  ): Promise<BuildArtifact> {
    const startedAt = performance.now();
    onProgress?.({ phase: 'initializing', message: 'Inicializando compilador WebAssembly…' });
    await initializeEsbuild(this.wasmUrl);

    onProgress?.({ phase: 'resolving', message: 'Resolvendo grafo de módulos…' });
    const project = prepareProject(fileSystem.snapshot());
    const plugin = createVirtualFilePlugin(project.files);

    onProgress?.({ phase: 'compiling', message: 'Compilando TypeScript e JSX…' });
    const result = await esbuild.build({
      entryPoints: [project.entryPoint],
      bundle: true,
      write: false,
      outfile: 'navebox.js',
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      jsx: 'automatic',
      jsxImportSource: project.framework === 'preact' ? 'preact' : 'react',
      sourcemap: 'inline',
      sourcesContent: true,
      treeShaking: true,
      charset: 'utf8',
      logLevel: 'silent',
      plugins: [plugin],
      define: {
        'process.env.NODE_ENV': JSON.stringify(this.development ? 'development' : 'production'),
        'import.meta.env.MODE': JSON.stringify(this.development ? 'development' : 'production'),
        'import.meta.env.DEV': String(this.development),
        'import.meta.env.PROD': String(!this.development),
        global: 'globalThis',
      },
    });

    const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
    const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
    const importMap = createImportMap(project.manifest, this.cdnBaseUrl, this.development);
    const warnings = result.warnings.map((warning) => warning.text);

    onProgress?.({ phase: 'rendering', message: 'Montando preview isolado…' });
    const html = createPreviewDocument({
      baseHtml: project.baseHtml,
      javascript,
      css,
      importMap,
      channel,
    });

    return {
      framework: project.framework,
      entryPoint: project.entryPoint,
      javascript,
      css,
      html,
      importMap,
      duration: performance.now() - startedAt,
      warnings,
    };
  }
}

async function initializeEsbuild(wasmUrl: string): Promise<void> {
  if (!initializePromise) {
    initializePromise = esbuild.initialize({
      wasmURL: wasmUrl,
      worker: true,
    });
  }
  await initializePromise;
}

function prepareProject(snapshot: VirtualFile[]): PreparedProject {
  const files = new Map(snapshot.map((file) => [normalizePath(file.path), file.content]));
  const manifest = parseManifest(files.get('/package.json'));
  const framework = detectFramework(files, manifest);
  const baseHtml = files.get('/index.html') ?? defaultHtml(framework);
  let entryPoint = findHtmlEntry(baseHtml);

  if (framework === 'next') {
    entryPoint = '/.navebox/next-entry.tsx';
    const page = resolveExistingFile(files, '/app/page') ?? resolveExistingFile(files, '/pages/index');
    if (!page) throw new Error('Next Lite: crie /app/page.tsx ou /pages/index.tsx.');
    const layout = resolveExistingFile(files, '/app/layout');
    files.set(entryPoint, createNextEntry(page, layout));
  } else if (!entryPoint) {
    entryPoint = findConventionalEntry(files, framework);
  } else {
    entryPoint = resolveExistingFile(files, entryPoint) ?? normalizePath(entryPoint);
  }

  if (!entryPoint || !files.has(entryPoint)) {
    throw new Error(`Entry point não encontrado${entryPoint ? `: ${entryPoint}` : '.'}`);
  }

  return { files, framework, entryPoint, baseHtml, manifest };
}

function parseManifest(raw: string | undefined): PackageManifest {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PackageManifest;
  } catch (error) {
    throw new Error(`package.json inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function detectFramework(
  files: Map<string, string>,
  manifest: PackageManifest,
): NaveboxFramework {
  const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
  if ([...files.keys()].some((path) => /^\/app\/page\.(tsx|ts|jsx|js)$/.test(path)) || dependencies.next) {
    return 'next';
  }
  if (dependencies.preact) return 'preact';
  if (dependencies.react || [...files.keys()].some((path) => /\.(tsx|jsx)$/.test(path))) return 'react';
  if (dependencies.express || dependencies.fastify || dependencies.hono || files.has('/server.js')) return 'node';
  return 'vanilla';
}

function findHtmlEntry(html: string): string | undefined {
  const match = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>/i)
    ?? html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return match?.[1];
}

function findConventionalEntry(files: Map<string, string>, framework: NaveboxFramework): string {
  const candidates = framework === 'vanilla'
    ? ['/src/main.ts', '/src/main.js', '/main.ts', '/main.js']
    : ['/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx'];
  return candidates.find((candidate) => files.has(candidate)) ?? '';
}

function resolveExistingFile(files: Map<string, string>, requestedPath: string): string | undefined {
  const normalized = normalizePath(requestedPath);
  if (files.has(normalized)) return normalized;
  if (extname(normalized)) return undefined;

  for (const extension of SOURCE_EXTENSIONS) {
    if (files.has(`${normalized}${extension}`)) return `${normalized}${extension}`;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    if (files.has(`${normalized}/index${extension}`)) return `${normalized}/index${extension}`;
  }
  return undefined;
}

function createNextEntry(page: string, layout?: string): string {
  const pageImport = JSON.stringify(page);
  const layoutImport = layout ? `import Layout from ${JSON.stringify(layout)};` : '';
  const content = layout ? '<Layout><Page /></Layout>' : '<Page />';
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from ${pageImport};
${layoutImport}

const mount = document.getElementById('__next') ?? document.getElementById('root') ?? (() => {
  const node = document.createElement('div');
  node.id = '__next';
  document.body.append(node);
  return node;
})();

createRoot(mount).render(
  <React.StrictMode>
    ${content}
  </React.StrictMode>,
);`;
}

function createVirtualFilePlugin(files: Map<string, string>): esbuild.Plugin {
  return {
    name: 'navebox-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (isExternalSpecifier(args.path)) return { path: args.path, external: true };

        const requested = args.kind === 'entry-point'
          ? normalizePath(args.path)
          : args.path.startsWith('/')
            ? normalizePath(args.path)
            : normalizePath(args.path, dirname(args.importer));
        const resolved = resolveExistingFile(files, requested);

        if (!resolved) {
          return {
            errors: [{ text: `Módulo local não encontrado: ${args.path} (importado por ${args.importer || 'entry'})` }],
          };
        }
        return { path: resolved, namespace: 'navebox-vfs' };
      });

      build.onLoad({ filter: /.*/, namespace: 'navebox-vfs' }, (args) => {
        const contents = files.get(args.path);
        if (contents === undefined) return { errors: [{ text: `Arquivo não encontrado: ${args.path}` }] };
        return {
          contents,
          loader: loaderForPath(args.path),
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

function isExternalSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !specifier.startsWith('file:');
}

function loaderForPath(path: string): esbuild.Loader {
  switch (extname(path)) {
    case '.tsx': return 'tsx';
    case '.ts': return 'ts';
    case '.jsx': return 'jsx';
    case '.js':
    case '.mjs': return 'js';
    case '.json': return 'json';
    case '.css': return 'css';
    default: return 'text';
  }
}

export function createImportMap(
  manifest: PackageManifest,
  cdnBaseUrl = 'https://esm.sh',
  development = true,
): Record<string, string> {
  const imports: Record<string, string> = {};
  const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
  const mode = development ? '?dev' : '?bundle';

  for (const [name, declaredVersion] of Object.entries(dependencies)) {
    if (name === 'next' || name.startsWith('@types/')) continue;
    const version = normalizePackageVersion(declaredVersion);
    const packageUrl = `${cdnBaseUrl}/${name}@${version}`;
    imports[name] = `${packageUrl}${mode}`;
    imports[`${name}/`] = `${packageUrl}/`;
  }

  const reactVersion = normalizePackageVersion(dependencies.react ?? '19.2.0');
  const reactDomVersion = normalizePackageVersion(dependencies['react-dom'] ?? reactVersion);
  if (dependencies.react || dependencies['react-dom'] || dependencies.next) {
    imports.react = `${cdnBaseUrl}/react@${reactVersion}${mode}`;
    imports['react/jsx-runtime'] = `${cdnBaseUrl}/react@${reactVersion}/jsx-runtime${mode}`;
    imports['react/jsx-dev-runtime'] = `${cdnBaseUrl}/react@${reactVersion}/jsx-dev-runtime${mode}`;
    imports['react-dom'] = `${cdnBaseUrl}/react-dom@${reactDomVersion}${mode}&external=react`;
    imports['react-dom/client'] = `${cdnBaseUrl}/react-dom@${reactDomVersion}/client${mode}&external=react`;
  }

  return imports;
}

function normalizePackageVersion(version: string): string {
  const normalized = String(version).trim().replace(/^[~^]/, '');
  if (!normalized || /^(workspace:|file:|link:|browser-lite)/.test(normalized)) return 'latest';
  return encodeURIComponent(normalized);
}

function defaultHtml(framework: NaveboxFramework): string {
  const id = framework === 'next' ? '__next' : framework === 'vanilla' ? 'app' : 'root';
  return `<div id="${id}"></div>`;
}

interface PreviewDocumentOptions {
  baseHtml: string;
  javascript: string;
  css: string;
  importMap: Record<string, string>;
  channel: string;
}

export function createPreviewDocument({
  baseHtml,
  javascript,
  css,
  importMap,
  channel,
}: PreviewDocumentOptions): string {
  const cleanBody = baseHtml.replace(MODULE_SCRIPT, '').replace(LOCAL_STYLESHEET, '');
  const documentHtml = /<html[\s>]/i.test(cleanBody)
    ? cleanBody
    : `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>${cleanBody}</body></html>`;

  const bridge = createConsoleBridge(channel);
  const importMapJson = JSON.stringify({ imports: importMap }).replaceAll('<', '\\u003c');
  const headInjection = [
    `<script>${escapeScript(bridge)}</script>`,
    `<script type="importmap">${importMapJson}</script>`,
    css ? `<style>${css.replaceAll('</style', '<\\/style')}</style>` : '',
  ].join('');
  const bodyInjection = `<script type="module">${escapeScript(javascript)}</script>`;

  const withHead = /<\/head>/i.test(documentHtml)
    ? documentHtml.replace(/<\/head>/i, `${headInjection}</head>`)
    : documentHtml.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${headInjection}</head>`);

  return /<\/body>/i.test(withHead)
    ? withHead.replace(/<\/body>/i, `${bodyInjection}</body>`)
    : `${withHead}${bodyInjection}`;
}

function escapeScript(source: string): string {
  return source.replaceAll('</script', '<\\/script');
}

function createConsoleBridge(channel: string): string {
  return `(() => {
  const channel = ${JSON.stringify(channel)};
  const send = (type, payload = {}) => parent.postMessage({ source: 'navebox-preview', channel, type, ...payload }, '*');
  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') return String(item) + 'n';
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      });
    } catch { return String(value); }
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      send('console', { level, text: args.map(format).join(' ') });
    };
  });
  addEventListener('error', (event) => send('error', { text: event.error?.stack || event.message }));
  addEventListener('unhandledrejection', (event) => send('error', { text: format(event.reason) }));
  addEventListener('DOMContentLoaded', () => send('ready'));
})();`;
}
