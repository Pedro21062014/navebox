import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeploymentKind, DeploymentRecord, DeploymentStatus } from '../types.js';

export class DeploymentStore {
  private readonly directory: string;

  constructor(dataDir: string) {
    this.directory = resolve(dataDir, 'deployments');
  }

  async create(input: { workspaceId: string; slug?: string; kind: DeploymentKind; target?: string }): Promise<DeploymentRecord> {
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      id,
      workspaceId: input.workspaceId,
      slug: `${sanitizeSlug(input.slug ?? 'app')}-${id.slice(0, 7)}`,
      kind: input.kind,
      target: input.target,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    await this.save(record);
    return record;
  }

  async get(id: string): Promise<DeploymentRecord | null> {
    assertId(id);
    try {
      return JSON.parse(await readFile(resolve(this.directory, `${id}.json`), 'utf8')) as DeploymentRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async require(id: string): Promise<DeploymentRecord> {
    const deployment = await this.get(id);
    if (!deployment) throw new Error(`Deployment não encontrado: ${id}`);
    return deployment;
  }

  async update(id: string, patch: Partial<Omit<DeploymentRecord, 'id' | 'createdAt'>>): Promise<DeploymentRecord> {
    const current = await this.require(id);
    const next: DeploymentRecord = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    await this.save(next);
    return next;
  }

  async setStatus(id: string, status: DeploymentStatus, patch: Partial<DeploymentRecord> = {}): Promise<DeploymentRecord> {
    return this.update(id, { ...patch, status });
  }

  async list(): Promise<DeploymentRecord[]> {
    await mkdir(this.directory, { recursive: true });
    return await Promise.all((await readdir(this.directory))
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => JSON.parse(await readFile(resolve(this.directory, name), 'utf8')) as DeploymentRecord));
  }

  async delete(id: string): Promise<void> {
    assertId(id);
    await rm(resolve(this.directory, `${id}.json`), { force: true });
  }

  private async save(record: DeploymentRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  }
}

function sanitizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'app';
}

function assertId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de deployment inválido.');
}
