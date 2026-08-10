import { describe, expect, it, vi } from 'vitest';
import { NaveboxShell } from '../src/core/shell';
import { VirtualFileSystem } from '../src/core/virtual-file-system';

function makeShell() {
  const fs = new VirtualFileSystem([
    { path: '/package.json', content: '{"dependencies":{"react":"19.2.0"}}' },
    { path: '/src/main.ts', content: 'console.log("ok")' },
  ]);
  const onDev = vi.fn();
  return { fs, shell: new NaveboxShell(fs, { onDev }), onDev };
}

describe('NaveboxShell', () => {
  it('navega e lê o filesystem virtual', async () => {
    const { shell } = makeShell();
    await shell.execute('cd src');
    expect(shell.cwd).toBe('/src');
    const result = await shell.execute('cat main.ts');
    expect(result.lines?.[0].text).toContain('console.log');
  });

  it('redireciona echo sem acessar o disco real', async () => {
    const { shell, fs } = makeShell();
    await shell.execute('echo "hello browser" > /note.txt');
    await shell.execute('echo second >> /note.txt');
    expect(fs.readFile('/note.txt')).toBe('hello browser\nsecond\n');
  });

  it('registra pacotes no package.json', async () => {
    const { shell, fs } = makeShell();
    const result = await shell.execute('npm install @scope/pkg@2.1.0 lodash@4.17.21');
    const manifest = JSON.parse(fs.readFile('/package.json'));
    expect(manifest.dependencies['@scope/pkg']).toBe('2.1.0');
    expect(manifest.dependencies.lodash).toBe('4.17.21');
    expect(result.lines?.some((item) => item.kind === 'success')).toBe(true);
  });

  it('aciona o build virtual pelo script dev', async () => {
    const { shell, onDev } = makeShell();
    await shell.execute('npm run dev');
    expect(onDev).toHaveBeenCalledOnce();
  });
});
