import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { CreateWorkspaceInput, ProjectFile, WorkspaceCommands, WorkspaceRecord, WorkspaceStatus } from '../types.js';

export interface WorkspaceStoreOptions {
  dataDir: string;
  maxWorkspaces?: number;
  maxFiles?: number;
  maxProjectBytes?: number;
  maxFileBytes?: number;
}

export class WorkspaceStore {
  readonly workspacesDir: string;
  readonly metadataDir: string;
  private readonly maxWorkspaces: number;
  private readonly maxFiles: number;
  private readonly maxProjectBytes: number;
  private readonly maxFileBytes: number;

  constructor(options: WorkspaceStoreOptions) {
    this.workspacesDir = resolve(options.dataDir, 'workspaces');
    this.metadataDir = resolve(options.dataDir, 'metadata');
    this.maxWorkspaces = options.maxWorkspaces ?? 20;
    this.maxFiles = options.maxFiles ?? 1_000;
    this.maxProjectBytes = options.maxProjectBytes ?? 25 * 1024 * 1024;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.workspacesDir, { recursive: true }),
      mkdir(this.metadataDir, { recursive: true }),
    ]);
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    await this.initialize();
    const current = await this.list();
    if (current.length >= this.maxWorkspaces) throw new Error(`Limite de ${this.maxWorkspaces} workspaces atingido.`);
    validateFiles(input.files, this.maxFiles, this.maxProjectBytes, this.maxFileBytes);

    const id = randomUUID();
    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id,
      name: sanitizeName(input.name ?? 'navebox-app'),
      framework: input.framework ?? detectFramework(input.files),
      status: 'created',
      createdAt: now,
      updatedAt: now,
      commands: input.commands ?? deriveCommands(input.files),
    };
    const workspaceDir = this.pathFor(id);
    await mkdir(workspaceDir, { recursive: true });
    await this.writeFiles(id, input.files);
    await this.save(record);
    return record;
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    assertId(id);
    try {
      return JSON.parse(await readFile(resolve(this.metadataDir, `${id}.json`), 'utf8')) as WorkspaceRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async require(id: string): Promise<WorkspaceRecord> {
    const record = await this.get(id);
    if (!record) throw new Error(`Workspace não encontrado: ${id}`);
    return record;
  }

  async list(): Promise<WorkspaceRecord[]> {
    await this.initialize();
    const entries = await readdir(this.metadataDir, { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => JSON.parse(await readFile(resolve(this.metadataDir, entry.name), 'utf8')) as WorkspaceRecord));
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async update(id: string, patch: Partial<Omit<WorkspaceRecord, 'id' | 'createdAt'>>): Promise<WorkspaceRecord> {
    const current = await this.require(id);
    const next: WorkspaceRecord = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    await this.save(next);
    return next;
  }

  async setStatus(id: string, status: WorkspaceStatus, patch: Partial<WorkspaceRecord> = {}): Promise<WorkspaceRecord> {
    return this.update(id, { ...patch, status });
  }

  async writeFiles(id: string, files: ProjectFile[]): Promise<void> {
    assertId(id);
    validateFiles(files, this.maxFiles, this.maxProjectBytes, this.maxFileBytes);
    const root = this.pathFor(id);
    await mkdir(root, { recursive: true });

    for (const file of files) {
      const relativePath = safeRelativePath(file.path);
      const destination = resolve(root, relativePath);
      assertInside(root, destination);
      const data = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data, { mode: 0o600 });
    }
  }

  async readProjectFiles(id: string): Promise<ProjectFile[]> {
    const root = this.pathFor(id);
    const output: ProjectFile[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.navebox') continue;
        const path = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) {
          const data = await readFile(path);
          output.push({ path: `/${relative(root, path).split(sep).join('/')}`, content: data.toString('utf8') });
        }
      }
    };
    await visit(root);
    return output;
  }

  async delete(id: string): Promise<void> {
    assertId(id);
    await Promise.all([
      rm(this.pathFor(id), { recursive: true, force: true }),
      rm(resolve(this.metadataDir, `${id}.json`), { force: true }),
    ]);
  }

  async cleanupOlderThan(ttlMs: number): Promise<string[]> {
    const threshold = Date.now() - ttlMs;
    const removed: string[] = [];
    for (const workspace of await this.list()) {
      if (Date.parse(workspace.updatedAt) < threshold) {
        await this.delete(workspace.id);
        removed.push(workspace.id);
      }
    }
    return removed;
  }

  pathFor(id: string): string {
    assertId(id);
    return resolve(this.workspacesDir, id);
  }

  private async save(record: WorkspaceRecord): Promise<void> {
    await mkdir(this.metadataDir, { recursive: true });
    await writeFile(resolve(this.metadataDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  }
}

export function safeRelativePath(path: string): string {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Caminho de arquivo inválido.');
  const cleaned = path.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!cleaned || isAbsolute(cleaned) || cleaned.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Caminho inseguro rejeitado: ${path}`);
  }
  return cleaned;
}

function assertInside(root: string, destination: string): void {
  const relation = relative(root, destination);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error('Destino fora do workspace.');
}

function assertId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de workspace inválido.');
}

function validateFiles(files: ProjectFile[], maxFiles: number, maxProjectBytes: number, maxFileBytes: number): void {
  if (!Array.isArray(files) || !files.length) throw new Error('O projeto precisa conter ao menos um arquivo.');
  if (files.length > maxFiles) throw new Error(`Projeto excede ${maxFiles} arquivos.`);
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const path = safeRelativePath(file.path);
    if (seen.has(path)) throw new Error(`Arquivo duplicado: ${path}`);
    seen.add(path);
    const size = file.encoding === 'base64' ? Buffer.byteLength(file.content, 'base64') : Buffer.byteLength(file.content);
    if (size > maxFileBytes) throw new Error(`Arquivo excede o limite: ${path}`);
    total += size;
  }
  if (total > maxProjectBytes) throw new Error(`Projeto excede ${maxProjectBytes} bytes.`);
}

function sanitizeName(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return safe || 'navebox-app';
}

function detectFramework(files: ProjectFile[]): string {
  const manifest = files.find((file) => file.path.replace(/^\//, '') === 'package.json');
  if (!manifest) return 'node';
  try {
    const pkg = JSON.parse(manifest.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    if (deps.next) return 'next';
    if (deps.vite && deps.react) return 'react';
    if (deps.fastify || deps.express || deps.hono) return 'node-api';
    return 'node';
  } catch {
    return 'node';
  }
}

function deriveCommands(files: ProjectFile[]): WorkspaceCommands {
  const hasLock = files.some((file) => /(^|\/)(npm-shrinkwrap|package-lock)\.json$/.test(file.path));
  const manifest = files.find((file) => file.path.replace(/^\//, '') === 'package.json');
  let scripts: Record<string, string> = {};
  if (manifest) {
    try { scripts = (JSON.parse(manifest.content) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { /* validated during install */ }
  }
  const startScript = scripts.dev ? 'dev' : scripts.start ? 'start' : undefined;
  return {
    install: hasLock ? ['npm', 'ci'] : ['npm', 'install'],
    build: scripts.build ? ['npm', 'run', 'build'] : undefined,
    start: startScript ? ['npm', 'run', startScript] : ['node', 'server.js'],
  };
}
