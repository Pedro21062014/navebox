import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ArtifactStore, StoredArtifact } from '../types.js';
import { contentTypeForPath } from '../util/content-type.js';

export class LocalArtifactStore implements ArtifactStore {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<StoredArtifact> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}.navebox-meta.json`, JSON.stringify({ contentType }));
    return { key: normalizeKey(key), contentType, size: data.byteLength };
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const path = this.pathFor(key);
    try {
      const [data, metadata] = await Promise.all([
        readFile(path),
        readFile(`${path}.navebox-meta.json`, 'utf8').catch(() => ''),
      ]);
      const contentType = metadata
        ? (JSON.parse(metadata) as { contentType?: string }).contentType ?? contentTypeForPath(key)
        : contentTypeForPath(key);
      return { data, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const path = this.pathFor(prefix);
    await rm(path, { recursive: true, force: true });
  }

  publicUrl(): string | null {
    return null;
  }

  async list(prefix = ''): Promise<string[]> {
    const directory = this.pathFor(prefix || '.');
    const output: string[] = [];
    const visit = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (!entry.name.endsWith('.navebox-meta.json')) output.push(relative(this.root, path).replaceAll('\\', '/'));
      }
    };
    await visit(directory);
    return output.sort();
  }

  private pathFor(key: string): string {
    const normalized = normalizeKey(key);
    const destination = resolve(this.root, normalized);
    const relation = relative(this.root, destination);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
      if (normalized === '.') return this.root;
      throw new Error(`Chave de artifact insegura: ${key}`);
    }
    return destination;
  }
}

function normalizeKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '') || '.';
  if (normalized.split('/').some((part) => part === '..' || part === '')) throw new Error(`Chave inválida: ${key}`);
  return normalized;
}
