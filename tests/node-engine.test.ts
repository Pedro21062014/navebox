import { afterEach, describe, expect, it } from 'vitest';
import { CompatNodeEngine } from '../src/node/compat-engine';
import { getTemplate } from '../src/core/templates';
import { resetServerBridge } from '../src/kernel/server-bridge';
import { Runtime } from '../src/kernel/runtime';
import { VirtualFS } from '../src/kernel/virtual-fs';

describe('Navebox browser Node kernel', () => {
  let engine: CompatNodeEngine | undefined;

  afterEach(async () => {
    await engine?.stop();
    resetServerBridge();
  });

  it('executa módulos CommonJS com fs, path e crypto', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/project/data.txt', 'navebox');
    vfs.writeFileSync('/project/index.js', `
      const fs = require('node:fs');
      const path = require('path');
      const crypto = require('crypto');
      module.exports = {
        data: fs.readFileSync(path.join('/project', 'data.txt'), 'utf8'),
        uuid: crypto.randomUUID(),
      };
    `);
    const runtime = new Runtime(vfs, { cwd: '/project' });
    const result = runtime.runFile('/project/index.js').exports as { data: string; uuid: string };
    expect(result.data).toBe('navebox');
    expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sobe uma API HTTP real e atende JSON pelo bridge', async () => {
    engine = new CompatNodeEngine({ allowTrustedSameOrigin: true });
    await engine.boot(getTemplate('node-api').files);
    const server = await engine.start();

    expect(server.port).toBe(3000);
    const healthResponse = await engine.fetch('/api/health');
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      ok: true,
      runtime: 'node-browser',
    });

    const fileResponse = await engine.fetch('/api/file');
    await expect(fileResponse.json()).resolves.toMatchObject({
      message: expect.stringContaining('node:fs'),
    });
  }, 30_000);

  it('executa terminal POSIX no mesmo filesystem', async () => {
    engine = new CompatNodeEngine({ allowTrustedSameOrigin: true });
    await engine.boot(getTemplate('node-api').files);
    const result = await engine.run('cat', ['/project/data/message.txt']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('node:fs');
  });

  it('bloqueia execução same-origin sem consentimento explícito', async () => {
    engine = new CompatNodeEngine();
    await expect(engine.boot(getTemplate('node-api').files)).rejects.toThrow('allowTrustedSameOrigin');
  });
});
