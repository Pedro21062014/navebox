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

type Kernel = typeof import('../kernel/index');
type KernelVfs = InstanceType<Kernel['VirtualFS']>;
type KernelBridge = ReturnType<Kernel['getServerBridge']>;

export class CompatNodeEngine implements BrowserNodeEngine {
  readonly provider = 'compat' as const;
  status: NodeEngineStatus = 'idle';
  private readonly events = new NodeEngineEvents<NodeEngineStatus, NodeTerminalEvent, NodeServerInfo>();
  private readonly options: BrowserNodeEnvironmentOptions;
  private kernel: Kernel | null = null;
  private vfs: KernelVfs | null = null;
  private bridge: KernelBridge | null = null;
  private files: TemplateFile[] = [];
  private currentServer: NodeServerInfo | null = null;
  private devServer: InstanceType<Kernel['ViteDevServer']> | InstanceType<Kernel['NextDevServer']> | null = null;
  private booted = false;

  constructor(options: BrowserNodeEnvironmentOptions = {}) {
    this.options = options;
  }

  async boot(files: TemplateFile[]): Promise<void> {
    if (!this.options.allowTrustedSameOrigin) {
      throw new Error(
        'O engine Node compatível executa código na origem atual. Defina allowTrustedSameOrigin=true apenas para projetos confiáveis, ou use BrowserPod.',
      );
    }
    this.setStatus('booting');
    this.emit('system', 'Carregando kernel Node pré-compilado sob demanda…');
    this.kernel ??= await this.loadKernel();
    this.vfs = new this.kernel.VirtualFS();
    this.files = files.map((file) => ({ ...file }));
    for (const file of this.files) this.writeToVfs(file.path, file.content);
    this.kernel.initChildProcess(this.vfs);
    this.bridge = this.kernel.getServerBridge({
      onServerReady: (port, url) => {
        this.currentServer = { port, url };
        this.events.emitServer(this.currentServer);
        this.setStatus('running');
        this.emit('success', `Servidor Node ouvindo em ${url}`);
      },
    });
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      await this.bridge.initServiceWorker({
        swUrl: this.options.serviceWorkerUrl ?? '/navebox-sw.js',
      });
    }
    this.booted = true;
    this.setStatus('idle');
    this.emit('success', 'Kernel pronto · VFS montado em /project');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.ensureBooted();
    this.writeToVfs(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    this.ensureBooted();
    const target = this.projectPath(path);
    if (this.vfs?.existsSync(target)) this.vfs.unlinkSync(target);
  }

  async run(command: string, args: string[] = []): Promise<NodeRunResult> {
    this.ensureBooted();
    const line = [command, ...args.map(shellEscape)].join(' ');
    this.emit('system', `navebox:/project $ ${line}`);
    const result = await this.exec(line);
    if (result.stdout) this.emit('stdout', stripAnsi(result.stdout).trimEnd());
    if (result.stderr) this.emit(result.exitCode ? 'stderr' : 'stdout', stripAnsi(result.stderr).trimEnd());
    return result;
  }

  async start(): Promise<NodeServerInfo> {
    this.ensureBooted();
    if (this.bridge && this.currentServer) this.bridge.unregisterServer(this.currentServer.port);
    this.currentServer = null;
    const manifest = this.readManifest();
    const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
    // The built-in Next adapter provides React/Next browser bindings directly;
    // avoid downloading native SWC/Turbopack packages that cannot execute in a browser.
    if (Object.keys(dependencies).length && !dependencies.next && !this.vfs?.existsSync('/project/node_modules')) {
      this.setStatus('installing');
      const install = await this.run('npm', ['install']);
      if (install.exitCode !== 0) {
        this.setStatus('error');
        throw new Error(install.stderr || 'npm install falhou.');
      }
    }

    this.setStatus('booting');
    if (dependencies.next || dependencies.vite) {
      return this.startFrameworkServer(dependencies.next ? 'next' : 'vite');
    }

    const command = manifest.scripts?.dev
      ? ['npm', 'run', 'dev']
      : manifest.scripts?.start
        ? ['npm', 'start']
        : ['node', manifest.main ?? 'server.js'];
    const serverPromise = new Promise<NodeServerInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('O processo iniciou, mas não abriu uma porta HTTP em 90 segundos.'));
      }, 90_000);
      const unsubscribe = this.onServer((server) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(server);
      });
    });
    void this.run(command[0], command.slice(1)).then((result) => {
      if (result.exitCode !== 0 && !this.currentServer) this.setStatus('error');
    }).catch((error) => {
      this.emit('stderr', error instanceof Error ? error.message : String(error));
      this.setStatus('error');
    });
    return serverPromise;
  }

  async stop(): Promise<void> {
    this.devServer?.stop();
    this.devServer = null;
    if (this.bridge && this.currentServer) this.bridge.unregisterServer(this.currentServer.port);
    this.currentServer = null;
    this.setStatus('stopped');
  }

  onTerminal(listener: (event: NodeTerminalEvent) => void): () => void { return this.events.onTerminal(listener); }
  onStatus(listener: (status: NodeEngineStatus) => void): () => void { return this.events.onStatus(listener); }
  onServer(listener: (server: NodeServerInfo) => void): () => void { return this.events.onServer(listener); }

  /** Direct request helper used by tests and hosts that do not want a Service Worker. */
  async fetch(path = '/', init?: RequestInit): Promise<Response> {
    if (!this.bridge || !this.currentServer) throw new Error('Nenhum servidor Node está em execução.');
    const handler = this.bridge.createFetchHandler();
    const relative = path.replace(/^\/+/, '');
    const url = new URL(`http://navebox.local/__virtual__/${this.currentServer.port}/${relative}`);
    return handler(new Request(url, init));
  }

  private async loadKernel(): Promise<Kernel> {
    if (this.options.kernelLoader) {
      return await this.options.kernelLoader() as Kernel;
    }

    const packagedKernelPath = './runtime/kernel.js';
    const runtimeUrl = this.options.kernelUrl ?? (typeof window !== 'undefined'
      ? '/navebox-runtime/kernel.js'
      : (Reflect.construct(URL, [packagedKernelPath, import.meta.url]) as URL).href);
    try {
      return await import(/* @vite-ignore */ runtimeUrl) as Kernel;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Não foi possível carregar o kernel Node em ${runtimeUrl}. `
        + `Adicione naveboxPlugin() ao Vite ou configure nodeOptions.kernelUrl. ${detail}`,
      );
    }
  }

  private async exec(command: string): Promise<NodeRunResult> {
    const kernel = this.kernel as Kernel;
    return await new Promise<NodeRunResult>((resolve) => {
      kernel.setStreamingCallbacks({
        onStdout: (text) => this.emit('stdout', stripAnsi(text).trimEnd()),
        onStderr: (text) => this.emit('stderr', stripAnsi(text).trimEnd()),
      });
      kernel.exec(command, { cwd: '/project' }, (error, stdout, stderr) => {
        kernel.clearStreamingCallbacks();
        resolve({
          exitCode: error ? Number((error as Error & { code?: number }).code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      });
    });
  }

  private startFrameworkServer(framework: 'vite' | 'next'): NodeServerInfo {
    const kernel = this.kernel as Kernel;
    const vfs = this.vfs as KernelVfs;
    const bridge = this.bridge as KernelBridge;
    const port = 3000;
    this.devServer?.stop();
    this.devServer = framework === 'next'
      ? new kernel.NextDevServer(vfs, {
          port,
          root: '/project',
          appDir: '/project/app',
          pagesDir: '/project/pages',
          publicDir: '/project/public',
        })
      : new kernel.ViteDevServer(vfs, { port, root: '/project' });
    this.devServer.start();
    bridge.registerServer(this.devServer as unknown as Parameters<KernelBridge['registerServer']>[0], port);
    const server = this.currentServer ?? { port, url: bridge.getServerUrl(port) };
    this.currentServer = server;
    this.setStatus('running');
    this.emit('success', `${framework === 'next' ? 'Next' : 'Vite'} dev server executando no kernel Node.`);
    return server;
  }

  private readManifest(): {
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } {
    try {
      return JSON.parse(this.vfs?.readFileSync('/project/package.json', 'utf8') as string) as ReturnType<CompatNodeEngine['readManifest']>;
    } catch {
      return {};
    }
  }

  private writeToVfs(path: string, content: string): void {
    if (!this.vfs) throw new Error('VFS Node ainda não foi inicializado.');
    this.vfs.writeFileSync(this.projectPath(path), content);
  }

  private projectPath(path: string): string {
    const relative = path.replaceAll('\\', '/').replace(/^\/+/, '');
    if (relative.split('/').includes('..')) throw new Error(`Caminho inseguro: ${path}`);
    return `/project/${relative}`;
  }

  private ensureBooted(): void {
    if (!this.booted || !this.vfs || !this.kernel) throw new Error('Inicialize o ambiente Node com boot() primeiro.');
  }

  private emit(kind: NodeTerminalEvent['kind'], text: string): void {
    if (text) this.events.emitTerminal({ kind, text });
  }

  private setStatus(status: NodeEngineStatus): void {
    this.status = status;
    this.events.emitStatus(status);
  }
}

function shellEscape(value: string): string {
  return /^[a-z0-9_./:@=-]+$/i.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}
