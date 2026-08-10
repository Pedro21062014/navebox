import { describe, expect, it, vi } from 'vitest';
import { VirtualFileSystem } from '../src/core/virtual-file-system';
import { normalizePath } from '../src/core/path';

describe('VirtualFileSystem', () => {
  it('normaliza caminhos sem escapar da raiz', () => {
    expect(normalizePath('../../src/../app/page.tsx', '/project')).toBe('/app/page.tsx');
    expect(normalizePath('./main.ts', '/src')).toBe('/src/main.ts');
  });

  it('cria diretórios implícitos e monta uma árvore', () => {
    const fs = new VirtualFileSystem();
    fs.writeFile('/src/components/Button.tsx', 'export default 1');
    fs.writeFile('/src/main.tsx', 'import Button from "./components/Button"');

    expect(fs.isDirectory('/src/components')).toBe(true);
    expect(fs.readFile('/src/main.tsx')).toContain('Button');
    expect(fs.list('/').map((entry) => entry.path)).toEqual([
      '/src',
      '/src/components',
      '/src/components/Button.tsx',
      '/src/main.tsx',
    ]);
  });

  it('emite alterações, move e remove recursivamente', () => {
    const fs = new VirtualFileSystem([{ path: '/a/file.txt', content: 'hello' }]);
    const listener = vi.fn();
    fs.on('change', listener);

    fs.move('/a', '/b');
    expect(fs.readFile('/b/file.txt')).toBe('hello');
    fs.delete('/b', true);
    expect(fs.exists('/b')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exporta e importa um projeto', () => {
    const source = new VirtualFileSystem([{ path: '/index.js', content: '42' }]);
    const target = new VirtualFileSystem();
    target.import(source.export());
    expect(target.readFile('/index.js')).toBe('42');
  });
});
