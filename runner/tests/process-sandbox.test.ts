import { mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessSandbox } from '../src/sandbox/process-sandbox.js';
import { tempDirectory } from './helpers.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((fn) => fn())));

const limits = { memoryMb: 256, cpuLimit: 1, pidsLimit: 32, timeoutMs: 10_000 };

describe('ProcessSandbox', () => {
  it('executa processo real e captura stdout/stderr', async () => {
    const dir = await tempDirectory();
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const sandbox = new ProcessSandbox();
    const result = await sandbox.exec({
      workspaceId: 'test', cwd: dir,
      command: ['node', '-e', 'console.log("out"); console.error("err")'],
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'out\n', stderr: 'err\n' });
  });

  it('inicia uma API HTTP real, responde e encerra', async () => {
    const dir = await tempDirectory();
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(`${dir}/server.mjs`, `
      import http from 'node:http';
      http.createServer((req,res) => {
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify({ ok: true, url: req.url }));
      }).listen(Number(process.env.PORT), process.env.HOST);
    `);
    const sandbox = new ProcessSandbox();
    cleanup.push(() => sandbox.stop('api'));
    const started = await sandbox.start({ workspaceId: 'api', cwd: dir, command: ['node', 'server.mjs'], limits });
    const response = await fetch(`http://127.0.0.1:${started.port}/api/hello`);
    expect(await response.json()).toEqual({ ok: true, url: '/api/hello' });
    expect(sandbox.isRunning('api')).toBe(true);
    await sandbox.stop('api');
    expect(sandbox.isRunning('api')).toBe(false);
  });

  it('aplica timeout em processos presos', async () => {
    const dir = await tempDirectory();
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const sandbox = new ProcessSandbox();
    await expect(sandbox.exec({
      workspaceId: 'timeout', cwd: dir,
      command: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 100,
    })).rejects.toThrow('timeout');
  });
});
