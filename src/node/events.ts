export class NodeEngineEvents<Status, Terminal, Server> {
  private readonly statusListeners = new Set<(value: Status) => void>();
  private readonly terminalListeners = new Set<(value: Terminal) => void>();
  private readonly serverListeners = new Set<(value: Server) => void>();

  onStatus(listener: (value: Status) => void): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
  onTerminal(listener: (value: Terminal) => void): () => void { this.terminalListeners.add(listener); return () => this.terminalListeners.delete(listener); }
  onServer(listener: (value: Server) => void): () => void { this.serverListeners.add(listener); return () => this.serverListeners.delete(listener); }
  emitStatus(value: Status): void { this.statusListeners.forEach((listener) => listener(value)); }
  emitTerminal(value: Terminal): void { this.terminalListeners.forEach((listener) => listener(value)); }
  emitServer(value: Server): void { this.serverListeners.forEach((listener) => listener(value)); }
}
