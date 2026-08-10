import type { TemplateFile } from '../core/types';
import { NodeEngineEvents } from './events';
import type {
  BrowserNodeEngine,
  BrowserNodeEnvironmentOptions,
  NodeEngineStatus,
  NodeRunResult,
  NodeServerInfo,
  NodeTerminalEvent,
} from './types';

interface PodFile { write(data: string | ArrayBuffer): Promise<void>; close(): Promise<void>; }
interface PodTerminal {}
interface Pod {
  createDirectory(path: string): Promise<void>;
  createFile(path: string, type: 'text' | 'binary'): Promise<PodFile>;
  openFile?(path: string, type: 'text' | 'binary'): Promise<PodFile>;
  createCustomTerminal(options: { cols?: number; rows?: number; onOutput(buffer: ArrayBuffer): void }): Promise<PodTerminal>;
  run(command: string, args: string[], options: { cwd?: string; terminal?: PodTerminal; echo?: boolean }): Promise<unknown>;
  onPortal(callback: (portal: { url: string; port: number }) => void): void;
}

export class BrowserPodNodeEngine implements BrowserNodeEngine {
  readonly provider = 'browserpod' as const;
  status: NodeEngineStatus = 'idle';
  private readonly events = new NodeEngineEvents<NodeEngineStatus, NodeTerminalEvent, NodeServerInfo>();
  private pod: Pod | null = null;
  private terminal: PodTerminal | null = null;
  private files: TemplateFile[] = [];

  constructor(private readonly options: BrowserNodeEnvironmentOptions) {}

  async boot(files: TemplateFile[]): Promise<void> {
    if (!this.options.browserPodApiKey) throw new Error('browserPodApiKey é obrigatório para o engine Node 22 completo.');
    this.setStatus('booting');
    this.emit('system', 'Inicializando Node 22/WebAssembly…');
    const module = await import('@leaningtech/browserpod');
    this.pod = await module.BrowserPod.boot({
      apiKey: this.options.browserPodApiKey,
      storageKey: this.options.browserPodStorageKey,
    }) as unknown as Pod;
    this.terminal = await this.pod.createCustomTerminal({
      cols: 120,
      rows: 36,
      onOutput: (buffer) => this.emit('stdout', stripAnsi(new TextDecoder().decode(buffer)).trimEnd()),
    });
    this.pod.onPortal(({ url, port }) => {
      this.events.emitServer({ url, port });
      this.setStatus('running');
      this.emit('success', `Portal Node disponível em ${url}`);
    });
    await this.pod.createDirectory('/project').catch(() => undefined);
    this.files = files.map((file) => ({ ...file }));
    for (const file of files) await this.writeFile(file.path, file.content);
    this.setStatus('idle');
    this.emit('success', 'Node 22 completo pronto no navegador.');
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.pod) throw new Error('BrowserPod ainda não inicializado.');
    const destination = this.projectPath(path);
    await this.ensureParents(destination);
    let file: PodFile;
    try {
      file = this.pod.openFile ? await this.pod.openFile(destination, 'text') : await this.pod.createFile(destination, 'text');
    } catch {
      file = await this.pod.createFile(destination, 'text');
    }
    await file.write(content);
    await file.close();
  }

  async deleteFile(): Promise<void> {
    this.emit('system', 'Exclusão será aplicada na próxima sincronização completa do Pod.');
  }

  async run(command: string, args: string[] = []): Promise<NodeRunResult> {
    if (!this.pod || !this.terminal) throw new Error('BrowserPod ainda não inicializado.');
    this.emit('system', `navebox:/project $ ${[command, ...args].join(' ')}`);
    await this.pod.run(command, args, { cwd: '/project', terminal: this.terminal, echo: true });
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  async start(): Promise<NodeServerInfo> {
    if (!this.pod) throw new Error('BrowserPod ainda não inicializado.');
    const manifestFile = this.files.find((file) => file.path.replace(/^\//, '') === 'package.json');
    const manifest = manifestFile ? JSON.parse(manifestFile.content) as { scripts?: Record<string, string>; dependencies?: Record<string, string> } : {};
    if (Object.keys(manifest.dependencies ?? {}).length) {
      this.setStatus('installing');
      await this.run('npm', ['install']);
    }
    this.setStatus('booting');
    const command = manifest.scripts?.dev ? ['npm', ['run', 'dev']] as const
      : manifest.scripts?.start ? ['npm', ['start']] as const
        : ['node', ['server.js']] as const;
    const server = new Promise<NodeServerInfo>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Node iniciou, mas nenhum Portal HTTP foi aberto.')); }, 120_000);
      const off = this.onServer((value) => { clearTimeout(timer); off(); resolve(value); });
    });
    void this.run(command[0], [...command[1]]).catch((error) => {
      this.emit('stderr', error instanceof Error ? error.message : String(error));
      this.setStatus('error');
    });
    return server;
  }

  async stop(): Promise<void> { this.setStatus('stopped'); }
  onTerminal(listener: (event: NodeTerminalEvent) => void): () => void { return this.events.onTerminal(listener); }
  onStatus(listener: (status: NodeEngineStatus) => void): () => void { return this.events.onStatus(listener); }
  onServer(listener: (server: NodeServerInfo) => void): () => void { return this.events.onServer(listener); }

  private async ensureParents(path: string): Promise<void> {
    if (!this.pod) return;
    const parts = path.split('/').filter(Boolean).slice(0, -1);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      await this.pod.createDirectory(current).catch(() => undefined);
    }
  }
  private projectPath(path: string): string {
    const relative = path.replaceAll('\\', '/').replace(/^\/+/, '');
    if (relative.split('/').includes('..')) throw new Error(`Caminho inseguro: ${path}`);
    return `/project/${relative}`;
  }
  private emit(kind: NodeTerminalEvent['kind'], text: string): void { if (text) this.events.emitTerminal({ kind, text }); }
  private setStatus(status: NodeEngineStatus): void { this.status = status; this.events.emitStatus(status); }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
