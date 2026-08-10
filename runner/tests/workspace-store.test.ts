import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore, safeRelativePath } from '../src/services/workspace-store.js';
import { tempDirectory } from './helpers.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function makeStore(options = {}) {
  const dataDir = await tempDirectory();
  directories.push(dataDir);
  const store = new WorkspaceStore({ dataDir, ...options });
  await store.initialize();
  return store;
}

describe('WorkspaceStore', () => {
  it('cria, persiste, lista e atualiza workspace', async () => {
    const store = await makeStore();
    const created = await store.create({ name: 'My API!', files: [{ path: '/server.js', content: '42' }] });
    expect(created.name).toBe('my-api');
    expect((await store.require(created.id)).framework).toBe('node');
    expect(await store.list()).toHaveLength(1);
    expect((await store.setStatus(created.id, 'running', { port: 3000 })).port).toBe(3000);
  });

  it('deriva comandos e detecta Next', async () => {
    const store = await makeStore();
    const workspace = await store.create({
      files: [{ path: 'package.json', content: JSON.stringify({ dependencies: { next: '16' }, scripts: { dev: 'next dev', build: 'next build' } }) }],
    });
    expect(workspace.framework).toBe('next');
    expect(workspace.commands.start).toEqual(['npm', 'run', 'dev']);
    expect(workspace.commands.build).toEqual(['npm', 'run', 'build']);
  });

  it.each(['../secret', '/a/../../secret', 'a//b', '\0bad'])(
    'rejeita path traversal: %s',
    (path) => expect(() => safeRelativePath(path)).toThrow(),
  );

  it('rejeita arquivos duplicados e limites', async () => {
    const store = await makeStore({ maxFiles: 1, maxFileBytes: 4 });
    await expect(store.create({ files: [{ path: 'a', content: '12345' }] })).rejects.toThrow('limite');
    await expect(store.create({ files: [{ path: 'a', content: '1' }, { path: 'b', content: '2' }] })).rejects.toThrow('1 arquivos');
  });

  it('lê arquivos ignorando node_modules e remove workspace', async () => {
    const store = await makeStore();
    const workspace = await store.create({ files: [{ path: '/src/a.js', content: 'a' }] });
    await store.writeFiles(workspace.id, [{ path: '/node_modules/x.js', content: 'x' }]);
    expect(await store.readProjectFiles(workspace.id)).toEqual([{ path: '/src/a.js', content: 'a' }]);
    await store.delete(workspace.id);
    expect(await store.get(workspace.id)).toBeNull();
  });
});
