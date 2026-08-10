import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'navebox-vite-consumer-'));
const release = join(temp, 'release');
const app = join(temp, 'app');

try {
  await mkdir(release);
  await mkdir(join(app, 'src'), { recursive: true });
  run('npm', ['pack', '--pack-destination', release], root);
  const tarball = join(release, (await readdir(release)).find((name) => name.endsWith('.tgz')));

  await writeFile(join(app, 'package.json'), JSON.stringify({
    name: 'navebox-consumer-build-test',
    private: true,
    type: 'module',
    scripts: { build: 'vite build' },
  }, null, 2));
  await writeFile(join(app, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await writeFile(join(app, 'src/main.tsx'), `
import { createRoot } from 'react-dom/client';
import { Navebox } from '@pedrobef/navebox';
import '@pedrobef/navebox/style.css';
createRoot(document.getElementById('root')!).render(<Navebox initialTemplate="react" />);
`);
  await writeFile(join(app, 'vite.config.ts'), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { naveboxPlugin } from '@pedrobef/navebox/vite';
export default defineConfig({ plugins: [react(), naveboxPlugin()] });
`);

  run('npm', [
    'install', '--ignore-scripts', '--prefer-offline',
    tarball, 'react@19.2.8', 'react-dom@19.2.8', 'vite@8.2.1', '@vitejs/plugin-react@6.0.5',
  ], app);
  const build = run('npm', ['run', 'build'], app, {
    ...process.env,
    NODE_OPTIONS: '--max-old-space-size=256',
  });

  await requiredFile(join(app, 'dist/navebox-sw.js'));
  await requiredFile(join(app, 'dist/navebox-runtime/kernel.js'));
  await requiredFile(join(app, 'dist/navebox-runtime/esbuild.wasm'));
  const assetFiles = await walk(join(app, 'dist/assets'));
  const rebundledKernel = assetFiles.filter((path) => /kernel|index\.web/i.test(basename(path)));
  if (rebundledKernel.length) {
    throw new Error(`O Vite reempacotou o kernel em dist/assets: ${rebundledKernel.map((path) => basename(path)).join(', ')}`);
  }
  const appJsBytes = (await Promise.all(assetFiles
    .filter((path) => path.endsWith('.js'))
    .map(async (path) => (await stat(path)).size)))
    .reduce((sum, size) => sum + size, 0);
  if (appJsBytes > 700_000) throw new Error(`Bundle do aplicativo ficou grande demais: ${appJsBytes} bytes.`);
  const cleanOutput = build.stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  if (!/\d+ modules transformed/.test(cleanOutput)) {
    throw new Error('Saída de build Vite inesperada.');
  }
  console.log(`Vite consumer build: OK (${appJsBytes} bytes de JS do app, kernel externo copiado)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} falhou com status ${result.status}.`);
  }
  return result;
}

async function requiredFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Arquivo esperado ausente: ${path}`);
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}
