export type WorkspaceStatus = 'created' | 'installing' | 'starting' | 'running' | 'stopped' | 'failed';
export type DeploymentStatus = 'queued' | 'building' | 'uploading' | 'deploying' | 'ready' | 'failed';

export interface ProjectFile {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface WorkspaceCommands {
  install?: string[];
  build?: string[];
  start?: string[];
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  framework: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  commands: WorkspaceCommands;
  port?: number;
  error?: string;
}

export interface CreateWorkspaceInput {
  name?: string;
  framework?: string;
  files: ProjectFile[];
  commands?: WorkspaceCommands;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface StartResult {
  port: number;
  pid?: number;
  containerId?: string;
}

export interface SandboxLimits {
  memoryMb: number;
  cpuLimit: number;
  pidsLimit: number;
  timeoutMs: number;
}

export interface SandboxStartOptions {
  workspaceId: string;
  cwd: string;
  command: string[];
  env?: Record<string, string>;
  requestedPort?: number;
  limits: SandboxLimits;
  onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface SandboxExecOptions {
  workspaceId: string;
  cwd: string;
  command: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface SandboxProvider {
  readonly kind: 'process' | 'docker';
  exec(options: SandboxExecOptions): Promise<ExecuteResult>;
  start(options: SandboxStartOptions): Promise<StartResult>;
  stop(workspaceId: string): Promise<void>;
  isRunning(workspaceId: string): boolean;
  getPort(workspaceId: string): number | undefined;
}

export interface StoredArtifact {
  key: string;
  contentType: string;
  size: number;
  etag?: string;
}

export interface ArtifactStore {
  readonly kind: 'local' | 'supabase';
  put(key: string, data: Uint8Array, contentType: string): Promise<StoredArtifact>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  deletePrefix(prefix: string): Promise<void>;
  publicUrl(key: string): string | null;
}

export type DeploymentKind = 'static' | 'container' | 'ssh-docker' | 'kubernetes';

export interface DeploymentRecord {
  id: string;
  workspaceId: string;
  slug: string;
  kind: DeploymentKind;
  target?: string;
  status: DeploymentStatus;
  url?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  artifactCount?: number;
}

export interface DeploymentContext {
  deployment: DeploymentRecord;
  workspace: WorkspaceRecord;
  workspaceDir: string;
  env: Record<string, string>;
  image?: string;
}

export interface DeployAdapter {
  readonly kind: DeploymentKind;
  deploy(context: DeploymentContext): Promise<{ url: string; metadata?: Record<string, unknown> }>;
  remove?(deployment: DeploymentRecord): Promise<void>;
}
