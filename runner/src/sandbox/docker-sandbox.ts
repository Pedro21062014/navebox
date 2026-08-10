import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { assertCommand, runProcess } from '../util/process.js';
import type { ExecuteResult, SandboxExecOptions, SandboxProvider, SandboxStartOptions, StartResult } from '../types.js';

interface RunningContainer {
  id: string;
  port: number;
  logs?: ChildProcess;
}

export interface DockerSandboxOptions {
  image?: string;
  dockerBinary?: string;
}

export class DockerSandbox implements SandboxProvider {
  readonly kind = 'docker' as const;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly containers = new Map<string, RunningContainer>();

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? 'node:20-alpine';
    this.dockerBinary = options.dockerBinary ?? 'docker';
  }

  async exec(options: SandboxExecOptions): Promise<ExecuteResult> {
    assertCommand(options.command);
    const name = containerName(`${options.workspaceId}-exec-${Date.now()}`);
    const args = [
      'run', '--rm', '--name', name,
      '--init', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--pids-limit=128', '--memory=768m', '--cpus=1',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
      '-v', `${resolve(options.cwd)}:/workspace`, '-w', '/workspace',
      ...environmentArgs(options.env),
      this.image,
      ...options.command,
    ];
    return runProcess(this.dockerBinary, args, {
      timeoutMs: options.timeoutMs,
      onLog: options.onLog,
    });
  }

  async start(options: SandboxStartOptions): Promise<StartResult> {
    assertCommand(options.command);
    await this.stop(options.workspaceId);
    const name = containerName(options.workspaceId);
    const containerPort = options.requestedPort ?? 3000;
    const command = options.command.map((part) => part.replaceAll('$PORT', String(containerPort)));
    const result = await runProcess(this.dockerBinary, [
      'run', '-d', '--name', name,
      '--init', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      `--pids-limit=${options.limits.pidsLimit}`,
      `--memory=${options.limits.memoryMb}m`,
      `--cpus=${options.limits.cpuLimit}`,
      '--restart=no',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
      '-p', `127.0.0.1::${containerPort}`,
      '-v', `${resolve(options.cwd)}:/workspace`, '-w', '/workspace',
      '-e', `PORT=${containerPort}`, '-e', 'HOST=0.0.0.0', '-e', 'HOSTNAME=0.0.0.0',
      ...environmentArgs(options.env),
      this.image,
      ...command,
    ], { timeoutMs: 30_000 });
    if (result.exitCode !== 0) throw new Error(`docker run falhou: ${result.stderr || result.stdout}`);
    const id = result.stdout.trim();
    const inspect = await runProcess(this.dockerBinary, ['port', id, `${containerPort}/tcp`], { timeoutMs: 10_000 });
    if (inspect.exitCode !== 0) {
      await runProcess(this.dockerBinary, ['rm', '-f', id]);
      throw new Error(`Não foi possível descobrir a porta do container: ${inspect.stderr}`);
    }
    const portMatch = inspect.stdout.match(/:(\d+)\s*$/m);
    if (!portMatch) throw new Error(`Resposta inesperada de docker port: ${inspect.stdout}`);
    const port = Number(portMatch[1]);
    const logs = spawn(this.dockerBinary, ['logs', '-f', id], { stdio: ['ignore', 'pipe', 'pipe'] });
    logs.stdout?.on('data', (chunk: Buffer) => options.onLog?.('stdout', chunk.toString('utf8')));
    logs.stderr?.on('data', (chunk: Buffer) => options.onLog?.('stderr', chunk.toString('utf8')));
    this.containers.set(options.workspaceId, { id, port, logs });
    return { port, containerId: id };
  }

  async stop(workspaceId: string): Promise<void> {
    const running = this.containers.get(workspaceId);
    this.containers.delete(workspaceId);
    if (!running) return;
    running.logs?.kill('SIGTERM');
    await runProcess(this.dockerBinary, ['rm', '-f', running.id], { timeoutMs: 20_000 }).catch(() => undefined);
  }

  isRunning(workspaceId: string): boolean {
    return this.containers.has(workspaceId);
  }

  getPort(workspaceId: string): number | undefined {
    return this.containers.get(workspaceId)?.port;
  }
}

function environmentArgs(environment: Record<string, string> = {}): string[] {
  return Object.entries(environment).flatMap(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) throw new Error(`Nome de variável inválido: ${key}`);
    return ['-e', `${key}=${value}`];
  });
}

function containerName(value: string): string {
  return `navebox-${value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 48)}`;
}
