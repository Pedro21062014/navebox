import { describe, expect, it, vi } from 'vitest';
import { NaveboxCloudClient } from '../src/remote/client';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('NaveboxCloudClient', () => {
  it('envia bearer e cria workspace', async () => {
    const fetch = vi.fn(async () => response({ workspace: { id: 'w1', name: 'app', framework: 'react', status: 'created' } }));
    const client = new NaveboxCloudClient({ endpoint: 'https://runner.example/', token: 'secret', fetch: fetch as typeof globalThis.fetch });
    const workspace = await client.createWorkspace({ files: [{ path: '/a.js', content: '42' }] });
    expect(workspace.id).toBe('w1');
    expect(fetch).toHaveBeenCalledWith('https://runner.example/v1/workspaces', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }));
  });

  it('executa pipeline create + deploy', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ workspace: { id: 'w1', name: 'app', framework: 'react', status: 'created' } }))
      .mockResolvedValueOnce(response({ deployment: { id: 'd1', workspaceId: 'w1', slug: 'app', kind: 'static', status: 'ready', url: 'https://app' } }));
    const client = new NaveboxCloudClient({ endpoint: 'https://runner.example', token: async () => 'dynamic', fetch });
    const result = await client.deployProject({ files: [{ path: '/index.html', content: 'ok' }], kind: 'static' });
    expect(result.deployment.url).toBe('https://app');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('propaga mensagem de erro do runner', async () => {
    const client = new NaveboxCloudClient({
      endpoint: 'https://runner.example', token: 'x',
      fetch: vi.fn(async () => response({ message: 'build falhou' }, 500)) as typeof globalThis.fetch,
    });
    await expect(client.getDeployment('d1')).rejects.toThrow('build falhou');
  });
});
