import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from '../src/storage/local-artifact-store.js';
import { SupabaseArtifactStore } from '../src/storage/supabase-artifact-store.js';
import { tempDirectory } from './helpers.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((fn) => fn())));

describe('artifact stores', () => {
  it('LocalArtifactStore grava, lê, lista e apaga prefixos', async () => {
    const dir = await tempDirectory();
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const store = new LocalArtifactStore(dir);
    await store.put('deployments/1/site/index.html', Buffer.from('<h1>ok</h1>'), 'text/html');
    await store.put('deployments/1/site/app.js', Buffer.from('42'), 'text/javascript');
    expect(Buffer.from((await store.get('deployments/1/site/index.html'))!.data).toString()).toContain('ok');
    expect(await store.list('deployments/1')).toEqual([
      'deployments/1/site/app.js',
      'deployments/1/site/index.html',
    ]);
    await store.deletePrefix('deployments/1');
    expect(await store.get('deployments/1/site/index.html')).toBeNull();
  });

  it('bloqueia chaves que escapam do storage', async () => {
    const store = new LocalArtifactStore(await tempDirectory());
    await expect(store.put('../secret', Buffer.from('x'), 'text/plain')).rejects.toThrow('inválida');
  });

  it('SupabaseArtifactStore usa API Storage real via HTTP', async () => {
    const requests: Array<{ method: string; url: string; auth?: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method!, url: request.url!, auth: request.headers.authorization, body });
      if (request.url?.includes('/list/')) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify([{ name: 'index.html' }]));
      } else if (request.method === 'GET') {
        response.setHeader('content-type', 'text/html');
        response.end('<h1>cloud</h1>');
      } else {
        response.statusCode = 200;
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const store = new SupabaseArtifactStore({
      url: `http://127.0.0.1:${address.port}`,
      serviceRoleKey: 'service-secret', bucket: 'sites', publicBucket: true,
    });
    await store.put('deployments/a/index.html', Buffer.from('hello'), 'text/html');
    const downloaded = await store.get('deployments/a/index.html');
    await store.deletePrefix('deployments/a');

    expect(Buffer.from(downloaded!.data).toString()).toContain('cloud');
    expect(requests[0]).toMatchObject({ method: 'POST', auth: 'Bearer service-secret' });
    expect(requests.some((item) => item.method === 'DELETE' && item.body.includes('index.html'))).toBe(true);
    expect(store.publicUrl('deployments/a/index.html')).toContain('/object/public/sites/');
  });
});
