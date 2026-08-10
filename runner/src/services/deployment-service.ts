import type { ArtifactStore, DeployAdapter, DeploymentKind, DeploymentRecord } from '../types.js';
import type { RunnerConfig } from '../config.js';
import { BuildService } from './build-service.js';
import { DeploymentStore } from './deployment-store.js';
import { LogBus } from './log-bus.js';
import { WorkspaceStore } from './workspace-store.js';

export interface CreateDeploymentInput {
  workspaceId: string;
  kind: DeploymentKind;
  slug?: string;
  target?: string;
  outputDir?: string;
  env?: Record<string, string>;
  image?: string;
}

export class DeploymentService {
  private readonly adapters = new Map<DeploymentKind, DeployAdapter>();

  constructor(
    private readonly workspaces: WorkspaceStore,
    private readonly deployments: DeploymentStore,
    private readonly buildService: BuildService,
    private readonly artifacts: ArtifactStore,
    private readonly logs: LogBus,
    private readonly config: RunnerConfig,
    adapters: DeployAdapter[] = [],
  ) {
    adapters.forEach((adapter) => this.adapters.set(adapter.kind, adapter));
  }

  async create(input: CreateDeploymentInput): Promise<DeploymentRecord> {
    const workspace = await this.workspaces.require(input.workspaceId);
    let deployment = await this.deployments.create({
      workspaceId: workspace.id,
      slug: input.slug ?? workspace.name,
      kind: input.kind,
      target: input.target,
    });
    this.logs.publish(workspace.id, 'system', `Deployment ${deployment.id} iniciado (${input.kind}).\n`);

    try {
      if (input.kind === 'static') {
        deployment = await this.deployments.setStatus(deployment.id, 'building');
        const result = await this.buildService.buildStatic(workspace, deployment.id, input.outputDir);
        deployment = await this.deployments.setStatus(deployment.id, 'ready', {
          artifactCount: result.artifacts.length,
          url: `${this.config.publicOrigin}/sites/${deployment.slug}/`,
        });
      } else {
        const adapter = this.adapters.get(input.kind);
        if (!adapter) throw new Error(`Adapter de deploy não configurado: ${input.kind}`);
        deployment = await this.deployments.setStatus(deployment.id, 'deploying');
        const result = await adapter.deploy({
          deployment,
          workspace,
          workspaceDir: this.workspaces.pathFor(workspace.id),
          env: sanitizeEnvironment(input.env ?? {}),
          image: input.image,
        });
        deployment = await this.deployments.setStatus(deployment.id, 'ready', { url: result.url });
      }
      this.logs.publish(workspace.id, 'system', `Deployment pronto: ${deployment.url}\n`);
      return deployment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deployments.setStatus(deployment.id, 'failed', { error: message });
      this.logs.publish(workspace.id, 'stderr', `Deployment falhou: ${message}\n`);
      throw error;
    }
  }

  async get(id: string): Promise<DeploymentRecord | null> {
    return this.deployments.get(id);
  }

  async remove(id: string): Promise<void> {
    const deployment = await this.deployments.require(id);
    await this.adapters.get(deployment.kind)?.remove?.(deployment);
    await this.artifacts.deletePrefix(`deployments/${deployment.id}`);
    await this.deployments.delete(id);
  }

  async getStaticArtifact(deployment: DeploymentRecord, requestedPath: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    if (deployment.kind !== 'static' || deployment.status !== 'ready') return null;
    const safePath = sanitizeSitePath(requestedPath);
    const prefix = `deployments/${deployment.id}/site`;
    const direct = await this.artifacts.get(`${prefix}/${safePath}`);
    if (direct) return direct;
    if (!safePath.includes('.')) return this.artifacts.get(`${prefix}/index.html`);
    return null;
  }

  async findBySlug(slug: string): Promise<DeploymentRecord | null> {
    return (await this.deployments.list()).find((deployment) => deployment.slug === slug) ?? null;
  }
}

function sanitizeEnvironment(environment: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) throw new Error(`Variável inválida: ${key}`);
    if (key.startsWith('NAVEBOX_') || key.includes('DOCKER_HOST')) throw new Error(`Variável reservada: ${key}`);
    output[key] = String(value);
  }
  return output;
}

function sanitizeSitePath(value: string): string {
  const decoded = decodeURIComponent(value).replace(/^\/+/, '') || 'index.html';
  if (decoded.includes('\0') || decoded.split('/').some((part) => part === '..')) throw new Error('Caminho de site inválido.');
  return decoded;
}
