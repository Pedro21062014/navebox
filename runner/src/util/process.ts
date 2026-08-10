import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { ExecuteResult } from '../types.js';

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string | Uint8Array;
  onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
  spawnOptions?: Omit<SpawnOptionsWithoutStdio, 'cwd' | 'env'>;
}

export async function runProcess(command: string, args: string[], options: RunProcessOptions = {}): Promise<ExecuteResult> {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;

  return await new Promise<ExecuteResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options.spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        rejectOnce(new Error(`Saída excedeu o limite de ${maxOutputBytes} bytes.`));
        return;
      }
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      options.onLog?.(stream, text);
    };

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', rejectOnce);
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        durationMs: performance.now() - startedAt,
      });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      rejectOnce(new Error(`Processo excedeu o timeout de ${timeoutMs}ms.`));
    }, timeoutMs);
    timer.unref();

    function rejectOnce(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function assertCommand(command: string[]): asserts command is [string, ...string[]] {
  if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string' || part.includes('\0'))) {
    throw new Error('Comando inválido: use um array não vazio de argumentos.');
  }
}
