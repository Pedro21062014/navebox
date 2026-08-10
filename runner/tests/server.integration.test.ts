import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProcessSandbox } from '../src/sandbox/process-sandbox.js';
import { buildServer } from '../src/server.js';
import { authHeaders, tempDirectory, testConfig } from './helpers.js';

let app: FastifyInstance;
let dataDir: string;

afterEach(async () => {
  await app?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  dataDir = await tempDirectory('navebox-server-');
  app = await buildServer({ config: testConfig(dataDir), sandbox: new ProcessSandbox(), logger: false });
});

describe('Runner HTTP API', () => {
  it('expõe health sem autenticação e protege /v1', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ ok: true, sandbox: 'process' });
    expect((await app.inject({ method: 'GET', url: '/v1/workspaces' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/workspaces', headers: authHeaders })).statusCode).toBe(200);
  });

  it('cria workspace, inicia API real e faz reverse proxy', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/workspaces', headers: authHeaders,
      payload: {
        name: 'real-api',
        commands: { start: ['node', 'server.mjs'] },
        files: [{
          path: '/server.mjs',
          content: `import http from 'node:http'; http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,path:req.url}))}).listen(Number(process.env.PORT), process.env.HOST);`,
        }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().workspace.id as string;
    const started = await app.inject({ method: 'POST', url: `/v1/workspaces/${id}/start`, headers: authHeaders, payload: {} });
    expect(started.statusCode).toBe(200);
    expect(started.json().workspace.status).toBe('running');

    const proxied = await app.inject({ method: 'GET', url: `/preview/${id}/api/health` });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.json()).toEqual({ ok: true, path: '/api/health' });

    const stopped = await app.inject({ method: 'POST', url: `/v1/workspaces/${id}/stop`, headers: authHeaders });
    expect(stopped.json().workspace.status).toBe('stopped');
  });

  it('executa comando real e disponibiliza histórico/token de logs', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/workspaces', headers: authHeaders,
      payload: { commands: {}, files: [{ path: '/index.js', content: '42' }] },
    });
    const id = created.json().workspace.id as string;
    const command = await app.inject({
      method: 'POST', url: `/v1/workspaces/${id}/commands`, headers: authHeaders,
      payload: { command: ['node', '-e', 'console.log(6*7)'] },
    });
    expect(command.json().result).toMatchObject({ exitCode: 0, stdout: '42\n' });
    const token = await app.inject({ method: 'POST', url: `/v1/workspaces/${id}/log-token`, headers: authHeaders });
    expect(token.statusCode).toBe(200);
    expect(token.json().token).toBeTypeOf('string');
  });

  it('valida payload e rejeita path traversal', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/workspaces', headers: authHeaders,
      payload: { files: [{ path: '../../etc/passwd', content: 'x' }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('inseguro');
  });
});
