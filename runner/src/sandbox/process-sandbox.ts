import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { assertCommand, runProcess } from '../util/process.js';
import type { ExecuteResult, SandboxExecOptions, SandboxProvider, SandboxStartOptions, StartResult } from '../types.js';

interface RunningProcess {
  child: ChildProcess;
  port: number;
}

export class ProcessSandbox implements SandboxProvider {
  readonly kind = 'process' as const;
  private readonly processes = new Map<string, RunningProcess>();

  async exec(options: SandboxExecOptions): Promise<ExecuteResult> {
    assertCommand(options.command);
    const [command, ...args] = options.command;
    return runProcess(command, args, {
      cwd: options.cwd,
      env: createEnvironment(options.env),
      timeoutMs: options.timeoutMs,
      onLog: options.onLog,
    });
  }

  async start(options: SandboxStartOptions): Promise<StartResult> {
    assertCommand(options.command);
    await this.stop(options.workspaceId);
    const port = options.requestedPort ?? await findAvailablePort();
    const commandWithPort = options.command.map((part) => part.replaceAll('$PORT', String(port)));
    const [command, ...args] = commandWithPort;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: createEnvironment({
        ...options.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        HOSTNAME: '127.0.0.1',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.processes.set(options.workspaceId, { child, port });
    child.stdout?.on('data', (chunk: Buffer) => options.onLog?.('stdout', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => options.onLog?.('stderr', chunk.toString('utf8')));
    child.once('exit', () => this.processes.delete(options.workspaceId));

    try {
      await waitForPort(port, options.limits.timeoutMs, child);
      return { port, pid: child.pid };
    } catch (error) {
      await this.stop(options.workspaceId);
      throw error;
    }
  }

  async stop(workspaceId: string): Promise<void> {
    const running = this.processes.get(workspaceId);
    if (!running) return;
    this.processes.delete(workspaceId);
    const pid = running.child.pid;
    if (pid && process.platform !== 'win32') {
      try { process.kill(-pid, 'SIGTERM'); } catch { running.child.kill('SIGTERM'); }
    } else {
      running.child.kill('SIGTERM');
    }
    await Promise.race([
      new Promise<void>((resolve) => running.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(() => {
        if (pid && process.platform !== 'win32') {
          try { process.kill(-pid, 'SIGKILL'); } catch { running.child.kill('SIGKILL'); }
        } else running.child.kill('SIGKILL');
        resolve();
      }, 2_000)),
    ]);
  }

  isRunning(workspaceId: string): boolean {
    const running = this.processes.get(workspaceId);
    return Boolean(running && running.child.exitCode === null && !running.child.killed);
  }

  getPort(workspaceId: string): number | undefined {
    return this.processes.get(workspaceId)?.port;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((id) => this.stop(id)));
  }
}

function createEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    NODE_ENV: 'development',
    FORCE_COLOR: '0',
    ...overrides,
  };
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Não foi possível reservar uma porta.'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou antes de abrir a porta ${port} (exit ${child.exitCode}).`);
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        socket.setTimeout(500);
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Servidor não abriu a porta ${port} em ${timeoutMs}ms: ${lastError}`);
}
