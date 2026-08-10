import type { TemplateFile } from '../core/types';

export type NaveboxExecutionMode = 'preview' | 'node';
export type NodeEngineProvider = 'auto' | 'compat' | 'browserpod';
export type NodeEngineStatus = 'idle' | 'booting' | 'installing' | 'running' | 'stopped' | 'error';

export interface NodeTerminalEvent {
  kind: 'stdout' | 'stderr' | 'system' | 'success';
  text: string;
}

export interface NodeServerInfo {
  port: number;
  url: string;
}

export interface NodeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BrowserNodeEnvironmentOptions {
  provider?: NodeEngineProvider;
  /** Optional BrowserPod key. When present with provider=auto, real Node 22/Wasm is used. */
  browserPodApiKey?: string;
  browserPodStorageKey?: string;
  /** Service Worker emitted by the Navebox Vite plugin or copied from the package. */
  serviceWorkerUrl?: string;
  /** URL of the precompiled Node kernel. The Vite plugin serves /navebox-runtime/kernel.js. */
  kernelUrl?: string;
  /** Advanced custom loader, useful for non-Vite hosts and source-level tests. */
  kernelLoader?: () => Promise<unknown>;
  /** Required for the local compatibility provider. Only execute trusted projects on the same origin. */
  allowTrustedSameOrigin?: boolean;
  cwd?: string;
}

export interface BrowserNodeEngine {
  readonly provider: Exclude<NodeEngineProvider, 'auto'>;
  readonly status: NodeEngineStatus;
  boot(files: TemplateFile[]): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  run(command: string, args?: string[]): Promise<NodeRunResult>;
  start(): Promise<NodeServerInfo>;
  stop(): Promise<void>;
  onTerminal(listener: (event: NodeTerminalEvent) => void): () => void;
  onStatus(listener: (status: NodeEngineStatus) => void): () => void;
  onServer(listener: (server: NodeServerInfo) => void): () => void;
}
