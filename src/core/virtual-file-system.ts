import { TypedEmitter } from './emitter';
import { basename, dirname, isInsidePath, normalizePath } from './path';
import type { FileTreeEntry, TemplateFile, VirtualFile } from './types';

interface FileSystemEvents extends Record<string, unknown> {
  change: { path: string; type: 'write' | 'delete' | 'move' | 'hydrate' };
}

interface SerializedFileSystem {
  version: 1;
  files: Array<Pick<VirtualFile, 'path' | 'content'>>;
}

export class VirtualFileSystem extends TypedEmitter<FileSystemEvents> {
  private readonly files = new Map<string, VirtualFile>();
  private readonly directories = new Set<string>(['/']);
  private persistenceKey: string | false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(files: TemplateFile[] = [], persistenceKey: string | false = false) {
    super();
    this.persistenceKey = persistenceKey;

    const restored = this.restore();
    if (!restored) this.hydrate(files, false);
  }

  setPersistenceKey(key: string | false): void {
    this.persistenceKey = key;
  }

  exists(path: string): boolean {
    const normalized = normalizePath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  isFile(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  isDirectory(path: string): boolean {
    return this.directories.has(normalizePath(path));
  }

  readFile(path: string): string {
    const normalized = normalizePath(path);
    const file = this.files.get(normalized);
    if (!file) throw new Error(`Arquivo não encontrado: ${normalized}`);
    return file.content;
  }

  tryReadFile(path: string): string | undefined {
    return this.files.get(normalizePath(path))?.content;
  }

  writeFile(path: string, content: string): VirtualFile {
    const normalized = normalizePath(path);
    if (normalized === '/') throw new Error('Não é possível sobrescrever a raiz.');
    this.ensureDirectory(dirname(normalized));

    const file: VirtualFile = {
      path: normalized,
      content,
      updatedAt: Date.now(),
    };
    this.files.set(normalized, file);
    this.changed(normalized, 'write');
    return file;
  }

  mkdir(path: string): void {
    const normalized = normalizePath(path);
    this.ensureDirectory(normalized);
    this.changed(normalized, 'write');
  }

  delete(path: string, recursive = false): void {
    const normalized = normalizePath(path);
    if (normalized === '/') throw new Error('Não é possível remover a raiz.');

    if (this.files.delete(normalized)) {
      this.changed(normalized, 'delete');
      return;
    }

    if (!this.directories.has(normalized)) throw new Error(`Caminho não encontrado: ${normalized}`);
    const children = this.entriesUnder(normalized);
    if (children.length > 0 && !recursive) {
      throw new Error(`Diretório não vazio: ${normalized}. Use rm -r.`);
    }

    for (const filePath of [...this.files.keys()]) {
      if (isInsidePath(normalized, filePath)) this.files.delete(filePath);
    }
    for (const directory of [...this.directories]) {
      if (directory !== '/' && isInsidePath(normalized, directory)) this.directories.delete(directory);
    }
    this.changed(normalized, 'delete');
  }

  move(from: string, to: string): void {
    const source = normalizePath(from);
    const destination = normalizePath(to);
    if (!this.exists(source)) throw new Error(`Caminho não encontrado: ${source}`);
    if (this.exists(destination)) throw new Error(`O destino já existe: ${destination}`);

    if (this.isFile(source)) {
      const content = this.readFile(source);
      this.files.delete(source);
      this.ensureDirectory(dirname(destination));
      this.files.set(destination, { path: destination, content, updatedAt: Date.now() });
    } else {
      this.ensureDirectory(destination);
      const fileMoves = [...this.files.values()].filter((file) => isInsidePath(source, file.path));
      const directoryMoves = [...this.directories].filter(
        (directory) => directory !== source && isInsidePath(source, directory),
      );
      for (const file of fileMoves) {
        this.files.delete(file.path);
        const target = `${destination}${file.path.slice(source.length)}`;
        this.files.set(target, { ...file, path: target, updatedAt: Date.now() });
      }
      for (const directory of directoryMoves) {
        this.directories.delete(directory);
        this.directories.add(`${destination}${directory.slice(source.length)}`);
      }
      this.directories.delete(source);
    }

    this.changed(destination, 'move');
  }

  list(path = '/'): FileTreeEntry[] {
    const root = normalizePath(path);
    if (!this.isDirectory(root)) throw new Error(`Diretório não encontrado: ${root}`);
    const rows: FileTreeEntry[] = [];

    const visit = (directory: string, depth: number): void => {
      const childDirectories = [...this.directories]
        .filter((candidate) => candidate !== directory && dirname(candidate) === directory)
        .sort((a, b) => a.localeCompare(b));
      const childFiles = [...this.files.values()]
        .filter((file) => dirname(file.path) === directory)
        .sort((a, b) => a.path.localeCompare(b.path));

      for (const child of childDirectories) {
        rows.push({ path: child, name: basename(child), type: 'directory', depth });
        visit(child, depth + 1);
      }
      for (const child of childFiles) {
        rows.push({ path: child.path, name: basename(child.path), type: 'file', depth });
      }
    };

    visit(root, 0);
    return rows;
  }

  listDirectory(path = '/'): Array<{ name: string; type: 'file' | 'directory'; path: string }> {
    const root = normalizePath(path);
    if (!this.isDirectory(root)) throw new Error(`Diretório não encontrado: ${root}`);
    return [
      ...[...this.directories]
        .filter((candidate) => candidate !== root && dirname(candidate) === root)
        .map((candidate) => ({ name: basename(candidate), type: 'directory' as const, path: candidate })),
      ...[...this.files.values()]
        .filter((file) => dirname(file.path) === root)
        .map((file) => ({ name: basename(file.path), type: 'file' as const, path: file.path })),
    ].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  }

  snapshot(): VirtualFile[] {
    return [...this.files.values()]
      .map((file) => ({ ...file }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  export(): string {
    const payload: SerializedFileSystem = {
      version: 1,
      files: this.snapshot().map(({ path, content }) => ({ path, content })),
    };
    return JSON.stringify(payload, null, 2);
  }

  import(serialized: string): void {
    const payload = JSON.parse(serialized) as SerializedFileSystem;
    if (payload.version !== 1 || !Array.isArray(payload.files)) {
      throw new Error('Projeto Navebox inválido.');
    }
    this.hydrate(payload.files);
  }

  hydrate(files: TemplateFile[], emit = true): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
    for (const file of files) {
      const path = normalizePath(file.path);
      this.ensureDirectory(dirname(path));
      this.files.set(path, { path, content: file.content, updatedAt: Date.now() });
    }
    if (emit) this.changed('/', 'hydrate');
  }

  clearPersistence(): void {
    if (this.persistenceKey && typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.persistenceKey);
    }
  }

  private ensureDirectory(path: string): void {
    const normalized = normalizePath(path);
    const pieces = normalized.split('/').filter(Boolean);
    let current = '';
    this.directories.add('/');
    for (const piece of pieces) {
      current += `/${piece}`;
      this.directories.add(current);
    }
  }

  private entriesUnder(path: string): string[] {
    return [
      ...[...this.files.keys()].filter((candidate) => isInsidePath(path, candidate)),
      ...[...this.directories].filter((candidate) => candidate !== path && isInsidePath(path, candidate)),
    ];
  }

  private changed(path: string, type: FileSystemEvents['change']['type']): void {
    this.schedulePersistence();
    this.emit('change', { path, type });
  }

  private schedulePersistence(): void {
    if (!this.persistenceKey || typeof localStorage === 'undefined') return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.persistenceKey as string, this.export());
      } catch {
        // Storage is an optional convenience; quota/privacy failures must not stop the runtime.
      }
    }, 120);
  }

  private restore(): boolean {
    if (!this.persistenceKey || typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(this.persistenceKey);
      if (!raw) return false;
      const payload = JSON.parse(raw) as SerializedFileSystem;
      if (payload.version !== 1 || !Array.isArray(payload.files)) return false;
      this.hydrate(payload.files, false);
      return true;
    } catch {
      return false;
    }
  }
}
