import { EventEmitter } from 'node:events';

export interface RuntimeLog {
  sequence: number;
  workspaceId: string;
  stream: 'system' | 'stdout' | 'stderr';
  text: string;
  timestamp: string;
}

export class LogBus {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, RuntimeLog[]>();
  private sequence = 0;

  publish(workspaceId: string, stream: RuntimeLog['stream'], text: string): RuntimeLog {
    const log: RuntimeLog = {
      sequence: ++this.sequence,
      workspaceId,
      stream,
      text,
      timestamp: new Date().toISOString(),
    };
    const buffer = this.buffers.get(workspaceId) ?? [];
    buffer.push(log);
    this.buffers.set(workspaceId, buffer.slice(-500));
    this.emitter.emit(workspaceId, log);
    return log;
  }

  history(workspaceId: string): RuntimeLog[] {
    return [...(this.buffers.get(workspaceId) ?? [])];
  }

  subscribe(workspaceId: string, listener: (log: RuntimeLog) => void): () => void {
    this.emitter.on(workspaceId, listener);
    return () => this.emitter.off(workspaceId, listener);
  }

  clear(workspaceId: string): void {
    this.buffers.delete(workspaceId);
  }
}
