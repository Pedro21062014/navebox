import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeployAdapter, DeploymentContext, DeploymentRecord, SandboxProvider } from '../types.js';
import type { RunnerConfig } from '../config.js';
import { LogBus } from '../services/log-bus.js';

export class RunnerContainerAdapter implements DeployAdapter {
  readonly kind = 'container' as const;
  private readonly deploymentPorts = new Map<string, number>();

  constructor(
    private readonly sandbox: SandboxProvider,
    private readonly logs: LogBus,
    private readonly config: RunnerConfig,
  ) {}

  async deploy(context: DeploymentContext): Promise<{ url: string }> {
    const id = `deployment-${context.deployment.id}`;
    const onLog = (stream: 'stdout' | 'stderr', text: string) => this.logs.publish(context.workspace.id, stream, `[deploy] ${text}`);
    for (const command of [context.workspace.commands.install, context.workspace.commands.build]) {
      if (!command) continue;
      const result = await this.sandbox.exec({
        workspaceId: `${id}-build`,
        cwd: context.workspaceDir,
        command,
        env: { ...context.env, NODE_ENV: 'production' },
        timeoutMs: 300_000,
        onLog,
      });
      if (result.exitCode !== 0) throw new Error(`Comando de deploy falhou: ${command.join(' ')} (exit ${result.exitCode})`);
    }
    const command = await productionCommand(context.workspaceDir);
    const started = await this.sandbox.start({
      workspaceId: id,
      cwd: context.workspaceDir,
      command,
      env: { ...context.env, NODE_ENV: 'production' },
      limits: this.config.limits,
      onLog,
    });
    this.deploymentPorts.set(context.deployment.id, started.port);
    return { url: `${this.config.publicOrigin}/apps/${context.deployment.id}/` };
  }

  async remove(deployment: DeploymentRecord): Promise<void> {
    this.deploymentPorts.delete(deployment.id);
    await this.sandbox.stop(`deployment-${deployment.id}`);
  }

  getPort(deploymentId: string): number | undefined {
    return this.deploymentPorts.get(deploymentId);
  }
}

async function productionCommand(workspaceDir: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(resolve(workspaceDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.start) return ['npm', 'run', 'start'];
    if (pkg.scripts?.preview) return ['npm', 'run', 'preview', '--', '--host', '0.0.0.0', '--port', '$PORT'];
  } catch {
    // Fall through to a conventional Node entry.
  }
  return ['node', 'server.js'];
}
