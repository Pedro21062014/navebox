import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessSandbox } from '../src/sandbox/process-sandbox.js';
import { buildServer } from '../src/server.js';
import { authHeaders, tempDirectory, testConfig } from './helpers.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((fn) => fn())));

describe('static deployment pipeline', () => {
  it('roda build real, armazena artefatos e publica URL com SPA fallback', async () => {
    const dataDir = await tempDirectory('navebox-deploy-');
    const app = await buildServer({ config: testConfig(dataDir), sandbox: new ProcessSandbox(), logger: false });
    cleanup.push(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });

    const workspaceResponse = await app.inject({
      method: 'POST', url: '/v1/workspaces', headers: authHeaders,
      payload: {
        name: 'hello-static',
        commands: { build: ['node', 'build.mjs'] },
        files: [
          { path: '/build.mjs', content: `import {mkdir,writeFile} from 'node:fs/promises'; await mkdir('dist/assets',{recursive:true}); await writeFile('dist/index.html','<!doctype html><h1>Deployed!</h1><script src="./assets/app.js"></script>'); await writeFile('dist/assets/app.js','console.log("live")');` },
          { path: '/package.json', content: '{"name":"hello","scripts":{"build":"node build.mjs"}}' },
        ],
      },
    });
    const workspaceId = workspaceResponse.json().workspace.id as string;
    const deployed = await app.inject({
      method: 'POST', url: '/v1/deployments', headers: authHeaders,
      payload: { workspaceId, kind: 'static', outputDir: 'dist', slug: 'hello' },
    });
    expect(deployed.statusCode).toBe(201);
    const deployment = deployed.json().deployment;
    expect(deployment).toMatchObject({ status: 'ready', artifactCount: 2 });

    const page = await app.inject({ method: 'GET', url: new URL(deployment.url).pathname });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Deployed!');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: `${new URL(deployment.url).pathname}assets/app.js` });
    expect(asset.body).toContain('live');
    expect(asset.headers['cache-control']).toContain('immutable');

    const fallback = await app.inject({ method: 'GET', url: `${new URL(deployment.url).pathname}dashboard/settings` });
    expect(fallback.body).toContain('Deployed!');
  });

  it('marca deployment como failed quando não existe index.html', async () => {
    const dataDir = await tempDirectory('navebox-deploy-fail-');
    const app = await buildServer({ config: testConfig(dataDir), sandbox: new ProcessSandbox(), logger: false });
    cleanup.push(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
    const workspace = await app.inject({
      method: 'POST', url: '/v1/workspaces', headers: authHeaders,
      payload: { commands: {}, files: [{ path: '/file.txt', content: 'no index' }] },
    });
    const response = await app.inject({
      method: 'POST', url: '/v1/deployments', headers: authHeaders,
      payload: { workspaceId: workspace.json().workspace.id, kind: 'static', outputDir: '.' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toContain('index.html');
  });
});
