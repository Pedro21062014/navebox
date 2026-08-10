import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { ExecuteResult, SandboxProvider, WorkspaceRecord } from '../types.js';
import type { RunnerConfig } from '../config.js';
import { LogBus } from './log-bus.js';
import { WorkspaceStore } from './workspace-store.js';

export class PreviewService {
  private readonly installed = new Set<string>();

  constructor(
    private readonly store: WorkspaceStore,
    private readonly sandbox: SandboxProvider,
    private readonly logs: LogBus,
    private readonly config: RunnerConfig,
  ) {}

  async start(workspaceId: string, environment: Record<string, string> = {}): Promise<{ workspace: WorkspaceRecord; url: string }> {
    let workspace = await this.store.require(workspaceId);
    const cwd = this.store.pathFor(workspaceId);
    const onLog = (stream: 'stdout' | 'stderr', text: string) => this.logs.publish(workspaceId, stream, text);

    try {
      const installCommand = workspace.commands.install;
      if (installCommand && !await this.isInstalled(workspaceId, cwd)) {
        workspace = await this.store.setStatus(workspaceId, 'installing');
        this.logs.publish(workspaceId, 'system', `> ${installCommand.join(' ')}\n`);
        const result = await this.sandbox.exec({
          workspaceId,
          cwd,
          command: installCommand,
          timeoutMs: this.config.limits.timeoutMs,
          onLog,
        });
        if (result.exitCode !== 0) throw new Error(`Instalação falhou (exit ${result.exitCode}).`);
        this.installed.add(workspaceId);
      }

      workspace = await this.store.setStatus(workspaceId, 'starting', { error: undefined });
      const command = prepareStartCommand(workspace);
      this.logs.publish(workspaceId, 'system', `> ${command.join(' ')}\n`);
      const started = await this.sandbox.start({
        workspaceId,
        cwd,
        command,
        env: sanitizeEnvironment(environment),
        limits: this.config.limits,
        onLog,
      });
      workspace = await this.store.setStatus(workspaceId, 'running', { port: started.port, error: undefined });
      const url = this.previewUrl(workspaceId);
      this.logs.publish(workspaceId, 'system', `Preview disponível em ${url}\n`);
      return { workspace, url };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.setStatus(workspaceId, 'failed', { error: message });
      this.logs.publish(workspaceId, 'stderr', `${message}\n`);
      throw error;
    }
  }

  async execute(workspaceId: string, command: string[], timeoutMs = 120_000): Promise<ExecuteResult> {
    await this.store.require(workspaceId);
    this.logs.publish(workspaceId, 'system', `> ${command.join(' ')}\n`);
    const result = await this.sandbox.exec({
      workspaceId,
      cwd: this.store.pathFor(workspaceId),
      command,
      timeoutMs: Math.min(timeoutMs, 300_000),
      onLog: (stream, text) => this.logs.publish(workspaceId, stream, text),
    });
    this.logs.publish(workspaceId, 'system', `Processo finalizado com exit ${result.exitCode} em ${Math.round(result.durationMs)}ms.\n`);
    return result;
  }

  async stop(workspaceId: string): Promise<WorkspaceRecord> {
    await this.store.require(workspaceId);
    await this.sandbox.stop(workspaceId);
    this.logs.publish(workspaceId, 'system', 'Preview encerrado.\n');
    return this.store.setStatus(workspaceId, 'stopped', { port: undefined });
  }

  async remove(workspaceId: string): Promise<void> {
    await this.sandbox.stop(workspaceId);
    await this.store.delete(workspaceId);
    this.logs.clear(workspaceId);
    this.installed.delete(workspaceId);
  }

  getPort(workspaceId: string): number | undefined {
    return this.sandbox.getPort(workspaceId);
  }

  private async isInstalled(workspaceId: string, cwd: string): Promise<boolean> {
    if (this.installed.has(workspaceId)) return true;
    try {
      await access(`${cwd}/node_modules`, constants.R_OK);
      this.installed.add(workspaceId);
      return true;
    } catch {
      return false;
    }
  }

  private previewUrl(workspaceId: string): string {
    if (this.config.previewDomain) return `https://${workspaceId}.${this.config.previewDomain}/`;
    return `${this.config.publicOrigin}/preview/${workspaceId}/`;
  }
}

function prepareStartCommand(workspace: WorkspaceRecord): string[] {
  const command = [...(workspace.commands.start ?? ['node', 'server.js'])];
  if (command[0] !== 'npm' || command[1] !== 'run') return command;
  const script = command[2];
  if (workspace.framework === 'next' && script === 'dev' && !command.includes('--hostname')) {
    return [...command, '--', '--hostname', '0.0.0.0', '--port', '$PORT'];
  }
  if ((workspace.framework === 'react' || workspace.framework === 'vite') && script === 'dev' && !command.includes('--host')) {
    return [...command, '--', '--host', '0.0.0.0', '--port', '$PORT'];
  }
  return command;
}

function sanitizeEnvironment(environment: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) throw new Error(`Variável de ambiente inválida: ${key}`);
    if (Buffer.byteLength(value) > 32_768) throw new Error(`Valor de ambiente muito grande: ${key}`);
    output[key] = value;
  }
  return output;
}
