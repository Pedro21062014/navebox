import { BrowserCompiler } from './compiler';
import { TypedEmitter } from './emitter';
import { normalizePath } from './path';
import { NaveboxShell } from './shell';
import { getTemplate, naveboxTemplates } from './templates';
import type {
  BuildArtifact,
  BuildProgress,
  NaveboxRuntimeOptions,
  NaveboxTemplate,
  RuntimeSnapshot,
  TerminalLine,
  TerminalLineKind,
} from './types';
import { VirtualFileSystem } from './virtual-file-system';

interface RuntimeEvents extends Record<string, unknown> {
  state: RuntimeSnapshot;
  files: { path: string; type: string };
  terminal: TerminalLine[];
  progress: BuildProgress;
  build: BuildArtifact;
}

interface PreviewMessage {
  source?: string;
  channel?: string;
  type?: 'ready' | 'console' | 'error';
  level?: string;
  text?: string;
}

let runtimeSequence = 0;
let terminalSequence = 0;

export class NaveboxRuntime extends TypedEmitter<RuntimeEvents> {
  readonly fileSystem: VirtualFileSystem;
  readonly shell: NaveboxShell;
  readonly compiler: BrowserCompiler;
  readonly previewChannel: string;

  private template: NaveboxTemplate;
  private terminalLines: TerminalLine[] = [];
  private snapshotValue: RuntimeSnapshot;
  private activeBuild: Promise<BuildArtifact> | null = null;
  private destroyed = false;

  constructor(options: NaveboxRuntimeOptions = {}) {
    super();
    this.template = getTemplate(options.template);
    this.previewChannel = `navebox-${Date.now().toString(36)}-${++runtimeSequence}`;
    const persistenceKey = options.persistenceKey === false
      ? false
      : options.persistenceKey
        ? `${options.persistenceKey}:${this.template.id}`
        : false;

    this.fileSystem = new VirtualFileSystem(this.template.files, persistenceKey);
    this.compiler = new BrowserCompiler(options);
    this.shell = new NaveboxShell(this.fileSystem, {
      onDev: async () => { await this.start(); },
      onBuild: async () => { await this.build(); },
      onReset: async () => { this.reset(); },
    });
    this.snapshotValue = {
      templateId: this.template.id,
      framework: this.template.framework,
      status: 'idle',
      activeFile: this.fileSystem.isFile(this.template.entryFile)
        ? this.template.entryFile
        : this.fileSystem.snapshot()[0]?.path ?? '',
      previewHtml: '',
      buildNumber: 0,
      error: null,
    };

    this.fileSystem.on('change', ({ path, type }) => {
      if (this.destroyed) return;
      if (this.snapshotValue.activeFile && !this.fileSystem.isFile(this.snapshotValue.activeFile)) {
        this.snapshotValue = {
          ...this.snapshotValue,
          activeFile: this.fileSystem.snapshot()[0]?.path ?? '',
        };
      }
      this.emit('files', { path, type });
      this.emitState();
    });

    this.pushTerminal('info', 'Navebox browser runtime 0.2.1');
    this.pushTerminal('muted', 'Filesystem virtual montado em / · digite “help” para comandos.');
  }

  get state(): RuntimeSnapshot {
    return { ...this.snapshotValue };
  }

  get lines(): TerminalLine[] {
    return this.terminalLines.map((item) => ({ ...item }));
  }

  get currentTemplate(): NaveboxTemplate {
    return this.template;
  }

  get templates(): NaveboxTemplate[] {
    return naveboxTemplates;
  }

  setActiveFile(path: string): void {
    const normalized = normalizePath(path);
    if (!this.fileSystem.isFile(normalized)) throw new Error(`Arquivo não encontrado: ${normalized}`);
    if (normalized === this.snapshotValue.activeFile) return;
    this.snapshotValue = { ...this.snapshotValue, activeFile: normalized };
    this.emitState();
  }

  writeFile(path: string, content: string): void {
    this.fileSystem.writeFile(path, content);
  }

  createFile(path: string, content = ''): void {
    const normalized = normalizePath(path);
    if (this.fileSystem.exists(normalized)) throw new Error(`O caminho já existe: ${normalized}`);
    this.fileSystem.writeFile(normalized, content);
    this.setActiveFile(normalized);
  }

  deleteFile(path: string): void {
    this.fileSystem.delete(path, true);
  }

  loadTemplate(template: string | NaveboxTemplate): void {
    this.template = getTemplate(template);
    this.fileSystem.clearPersistence();
    this.fileSystem.hydrate(this.template.files);
    this.snapshotValue = {
      ...this.snapshotValue,
      templateId: this.template.id,
      framework: this.template.framework,
      status: 'idle',
      activeFile: this.template.entryFile,
      previewHtml: '',
      error: null,
    };
    this.clearTerminal();
    this.pushTerminal('info', `${this.template.name} montado no filesystem virtual.`);
    this.pushTerminal('muted', 'Execute “npm run dev” ou use o botão Run.');
    this.emitState();
  }

  reset(): void {
    this.fileSystem.clearPersistence();
    this.fileSystem.hydrate(this.template.files);
    this.snapshotValue = {
      ...this.snapshotValue,
      activeFile: this.template.entryFile,
      status: 'idle',
      previewHtml: '',
      error: null,
    };
    this.emitState();
  }

  async start(): Promise<BuildArtifact> {
    return this.compile('development');
  }

  async build(): Promise<BuildArtifact> {
    return this.compile('build');
  }

  async runCommand(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    this.pushTerminal('command', `${this.shell.prompt} ${trimmed}`);
    const result = await this.shell.execute(trimmed);
    if (result.clear) {
      this.clearTerminal();
      return;
    }
    for (const output of result.lines ?? []) this.pushTerminal(output.kind, output.text);
  }

  handlePreviewMessage(data: unknown): boolean {
    const message = data as PreviewMessage;
    if (
      !message
      || message.source !== 'navebox-preview'
      || message.channel !== this.previewChannel
    ) return false;

    if (message.type === 'console') {
      const kind: TerminalLineKind = message.level === 'error'
        ? 'error'
        : message.level === 'warn'
          ? 'warning'
          : 'stdout';
      this.pushTerminal(kind, `[preview] ${message.text ?? ''}`);
    } else if (message.type === 'error') {
      this.pushTerminal('error', `[preview] ${message.text ?? 'Erro desconhecido'}`);
    }
    return true;
  }

  exportProject(): string {
    return this.fileSystem.export();
  }

  importProject(serialized: string): void {
    this.fileSystem.import(serialized);
    const firstFile = this.fileSystem.snapshot()[0]?.path ?? '';
    this.snapshotValue = {
      ...this.snapshotValue,
      activeFile: this.fileSystem.isFile(this.snapshotValue.activeFile)
        ? this.snapshotValue.activeFile
        : firstFile,
      previewHtml: '',
      status: 'idle',
      error: null,
    };
    this.emitState();
  }

  clearTerminal(): void {
    this.terminalLines = [];
    this.emit('terminal', this.lines);
  }

  destroy(): void {
    this.destroyed = true;
    this.removeAllListeners();
  }

  private async compile(mode: 'development' | 'build'): Promise<BuildArtifact> {
    if (this.activeBuild) return this.activeBuild;
    this.snapshotValue = { ...this.snapshotValue, status: 'building', error: null };
    this.emitState();
    this.pushTerminal('info', mode === 'build' ? 'Criando build otimizado…' : 'Compilando projeto…');

    this.activeBuild = this.compiler.compile(
      this.fileSystem,
      this.previewChannel,
      (progress) => {
        this.emit('progress', progress);
      },
    );

    try {
      const artifact = await this.activeBuild;
      this.snapshotValue = {
        ...this.snapshotValue,
        framework: artifact.framework,
        status: 'running',
        previewHtml: artifact.html,
        buildNumber: this.snapshotValue.buildNumber + 1,
        error: null,
      };
      this.pushTerminal(
        'success',
        `✓ ${artifact.framework} compilado em ${Math.round(artifact.duration)}ms · ${formatBytes(artifact.javascript.length + artifact.css.length)}`,
      );
      artifact.warnings.forEach((warning) => this.pushTerminal('warning', warning));
      this.emit('build', artifact);
      this.emitState();
      return artifact;
    } catch (error) {
      const message = formatBuildError(error);
      this.snapshotValue = { ...this.snapshotValue, status: 'error', error: message };
      this.pushTerminal('error', message);
      this.emitState();
      throw error;
    } finally {
      this.activeBuild = null;
    }
  }

  private pushTerminal(kind: TerminalLineKind, text: string): void {
    const item: TerminalLine = {
      id: ++terminalSequence,
      kind,
      text,
      timestamp: Date.now(),
    };
    this.terminalLines = [...this.terminalLines.slice(-399), item];
    this.emit('terminal', this.lines);
  }

  private emitState(): void {
    this.emit('state', this.state);
  }
}

function formatBuildError(error: unknown): string {
  if (error && typeof error === 'object' && 'errors' in error) {
    const errors = (error as { errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> }).errors;
    if (errors?.length) {
      return errors.map((entry) => {
        const location = entry.location;
        const prefix = location?.file
          ? `${location.file}:${location.line ?? 0}:${location.column ?? 0} — `
          : '';
        return `${prefix}${entry.text ?? 'Falha de compilação'}`;
      }).join('\n');
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}
