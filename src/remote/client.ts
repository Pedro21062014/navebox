import type { NaveboxFramework, TemplateFile } from '../core/types';

export type RemoteDeploymentKind = 'static' | 'container' | 'ssh-docker' | 'kubernetes';

export interface NaveboxCloudClientOptions {
  endpoint: string;
  token: string | (() => string | Promise<string>);
  fetch?: typeof globalThis.fetch;
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  framework: string;
  status: string;
  port?: number;
  error?: string;
}

export interface RemoteDeployment {
  id: string;
  workspaceId: string;
  slug: string;
  kind: RemoteDeploymentKind;
  status: string;
  url?: string;
  error?: string;
}

export interface DeployProjectInput {
  name?: string;
  framework?: NaveboxFramework | string;
  files: TemplateFile[];
  kind?: RemoteDeploymentKind;
  slug?: string;
  target?: string;
  outputDir?: string;
  env?: Record<string, string>;
  image?: string;
  commands?: {
    install?: string[];
    build?: string[];
    start?: string[];
  };
}

/** Typed client for the optional Navebox Runner and deployment gateway. */
export class NaveboxCloudClient {
  private readonly endpoint: string;
  private readonly token: NaveboxCloudClientOptions['token'];
  private readonly requestImpl: typeof globalThis.fetch;

  constructor(options: NaveboxCloudClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.token = options.token;
    this.requestImpl = options.fetch ?? globalThis.fetch;
  }

  async createWorkspace(input: Omit<DeployProjectInput, 'kind' | 'slug' | 'target' | 'outputDir' | 'env' | 'image'>): Promise<RemoteWorkspace> {
    const result = await this.request<{ workspace: RemoteWorkspace }>('/v1/workspaces', {
      method: 'POST', body: JSON.stringify(input),
    });
    return result.workspace;
  }

  async updateFiles(workspaceId: string, files: TemplateFile[]): Promise<void> {
    await this.request(`/v1/workspaces/${workspaceId}/files`, {
      method: 'PUT', body: JSON.stringify({ files }),
    });
  }

  async startPreview(workspaceId: string, env: Record<string, string> = {}): Promise<{ workspace: RemoteWorkspace; url: string }> {
    return this.request(`/v1/workspaces/${workspaceId}/start`, {
      method: 'POST', body: JSON.stringify({ env }),
    });
  }

  async stopPreview(workspaceId: string): Promise<RemoteWorkspace> {
    const result = await this.request<{ workspace: RemoteWorkspace }>(`/v1/workspaces/${workspaceId}/stop`, { method: 'POST' });
    return result.workspace;
  }

  async run(workspaceId: string, command: string[], timeoutMs?: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await this.request<{ result: { exitCode: number; stdout: string; stderr: string } }>(`/v1/workspaces/${workspaceId}/commands`, {
      method: 'POST', body: JSON.stringify({ command, timeoutMs }),
    });
    return result.result;
  }

  async deploy(input: {
    workspaceId: string;
    kind: RemoteDeploymentKind;
    slug?: string;
    target?: string;
    outputDir?: string;
    env?: Record<string, string>;
    image?: string;
  }): Promise<RemoteDeployment> {
    const result = await this.request<{ deployment: RemoteDeployment }>('/v1/deployments', {
      method: 'POST', body: JSON.stringify(input),
    });
    return result.deployment;
  }

  async deployProject(input: DeployProjectInput): Promise<{ workspace: RemoteWorkspace; deployment: RemoteDeployment }> {
    const workspace = await this.createWorkspace({
      name: input.name,
      framework: input.framework,
      files: input.files,
      commands: input.commands,
    });
    const deployment = await this.deploy({
      workspaceId: workspace.id,
      kind: input.kind ?? 'static',
      slug: input.slug,
      target: input.target,
      outputDir: input.outputDir,
      env: input.env,
      image: input.image,
    });
    return { workspace, deployment };
  }

  async getDeployment(id: string): Promise<RemoteDeployment> {
    const result = await this.request<{ deployment: RemoteDeployment }>(`/v1/deployments/${id}`);
    return result.deployment;
  }

  async subscribeLogs(workspaceId: string, listener: (log: unknown) => void): Promise<() => void> {
    const { token } = await this.request<{ token: string }>(`/v1/workspaces/${workspaceId}/log-token`, { method: 'POST' });
    const url = new URL(`${this.endpoint}/v1/workspaces/${workspaceId}/logs`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token);
    const socket = new WebSocket(url);
    socket.onmessage = (event) => {
      try { listener(JSON.parse(event.data as string)); } catch { listener(event.data); }
    };
    return () => socket.close();
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    const response = await this.requestImpl(`${this.endpoint}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) as T & { message?: string } : {} as T & { message?: string };
    if (!response.ok) throw new Error(body.message ?? `Navebox Runner respondeu ${response.status}.`);
    return body as T;
  }
}
