import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import { basename, extname } from '../core/path';
import { NaveboxRuntime } from '../core/runtime';
import { createBrowserNodeEngine } from '../node/environment';
import type {
  BrowserNodeEngine,
  BrowserNodeEnvironmentOptions,
  NaveboxExecutionMode,
  NodeEngineStatus,
  NodeServerInfo,
  NodeTerminalEvent,
} from '../node/types';
import type {
  FileTreeEntry,
  NaveboxRuntimeOptions,
  NaveboxTemplate,
  RuntimeSnapshot,
  TerminalLine,
} from '../core/types';

export interface NaveboxProps {
  runtime?: NaveboxRuntime;
  initialTemplate?: string | NaveboxTemplate;
  persistenceKey?: string | false;
  runtimeOptions?: Omit<NaveboxRuntimeOptions, 'template' | 'persistenceKey'>;
  /** Initial execution mode: fast browser preview or a Node-compatible environment. */
  defaultMode?: NaveboxExecutionMode;
  /** Configuration for the Node engine. BrowserPod is used when an API key is supplied. */
  nodeOptions?: BrowserNodeEnvironmentOptions;
  autoRun?: boolean;
  className?: string;
  height?: number | string;
  onReady?: (runtime: NaveboxRuntime) => void;
}

export function Navebox({
  runtime: providedRuntime,
  initialTemplate = 'react',
  persistenceKey = false,
  runtimeOptions,
  defaultMode = 'preview',
  nodeOptions,
  autoRun: initialAutoRun = true,
  className = '',
  height = 760,
  onReady,
}: NaveboxProps) {
  const [runtime] = useState(() => providedRuntime ?? new NaveboxRuntime({
    ...runtimeOptions,
    template: initialTemplate,
    persistenceKey,
  } satisfies NaveboxRuntimeOptions));
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() => runtime.state);
  const [mode, setMode] = useState<NaveboxExecutionMode>(defaultMode);
  const [nodeStatus, setNodeStatus] = useState<NodeEngineStatus>('idle');
  const [nodeServer, setNodeServer] = useState<NodeServerInfo | null>(null);
  const [nodeTerminalLines, setNodeTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>(() => runtime.lines);
  const [tree, setTree] = useState<FileTreeEntry[]>(() => runtime.fileSystem.list('/'));
  const [editorValue, setEditorValue] = useState(() => readActiveFile(runtime));
  const [progress, setProgress] = useState('Runtime pronto');
  const [autoRun, setAutoRun] = useState(initialAutoRun);
  const [terminalInput, setTerminalInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nodeEngineRef = useRef<BrowserNodeEngine | null>(null);
  const nodeEngineBootRef = useRef<Promise<BrowserNodeEngine> | null>(null);
  const nodeOptionsRef = useRef<BrowserNodeEnvironmentOptions>(nodeOptions ?? {});
  const nodeLineSequence = useRef(50_000);
  const autoRunTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activePath = snapshot.activeFile;
  const activeLanguage = languageLabel(activePath);
  const visibleTerminalLines = mode === 'node' ? nodeTerminalLines : terminalLines;
  const visibleStatus = mode === 'node' ? mapNodeStatus(nodeStatus) : snapshot.status;
  const lineCount = Math.max(1, editorValue.split('\n').length);
  const containerStyle = { '--nbx-height': typeof height === 'number' ? `${height}px` : height } as CSSProperties;

  const syncFiles = useCallback(() => {
    setTree(runtime.fileSystem.list('/'));
    setSnapshot(runtime.state);
    setEditorValue(readActiveFile(runtime));
  }, [runtime]);

  useEffect(() => {
    const unsubscribers = [
      runtime.on('state', (next) => {
        setSnapshot(next);
        setEditorValue(readActiveFile(runtime));
      }),
      runtime.on('files', syncFiles),
      runtime.on('terminal', setTerminalLines),
      runtime.on('progress', ({ message }) => setProgress(message)),
      runtime.on('build', (artifact) => setProgress(`Pronto em ${Math.round(artifact.duration)}ms`)),
    ];
    const onMessage = (event: MessageEvent) => runtime.handlePreviewMessage(event.data);
    window.addEventListener('message', onMessage);
    onReady?.(runtime);

    const timer = setTimeout(() => {
      if (defaultMode === 'preview') runtime.start().catch(() => undefined);
    }, 80);
    return () => {
      clearTimeout(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener('message', onMessage);
    };
  }, [defaultMode, onReady, runtime, syncFiles]);

  useEffect(() => {
    const terminal = terminalBodyRef.current;
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [visibleTerminalLines]);

  const appendNodeTerminal = useCallback((event: NodeTerminalEvent) => {
    const kind: TerminalLine['kind'] = event.kind === 'stderr'
      ? 'error'
      : event.kind === 'system'
        ? 'info'
        : event.kind === 'success'
          ? 'success'
          : 'stdout';
    setNodeTerminalLines((items) => [...items.slice(-399), {
      id: ++nodeLineSequence.current,
      kind,
      text: event.text,
      timestamp: Date.now(),
    }]);
  }, []);

  const ensureNodeEngine = useCallback(async (reset = false): Promise<BrowserNodeEngine> => {
    if (reset && nodeEngineRef.current) {
      await nodeEngineRef.current.stop().catch(() => undefined);
      nodeEngineRef.current = null;
      nodeEngineBootRef.current = null;
    }
    if (nodeEngineBootRef.current) return nodeEngineBootRef.current;
    if (nodeEngineRef.current) return nodeEngineRef.current;

    const engine = createBrowserNodeEngine(nodeOptionsRef.current);
    nodeEngineRef.current = engine;
    engine.onTerminal(appendNodeTerminal);
    engine.onStatus((status) => {
      setNodeStatus(status);
      setProgress(nodeStatusDescription(status));
    });
    engine.onServer((server) => setNodeServer(server));
    setNodeTerminalLines([]);

    const boot = engine.boot(runtime.fileSystem.snapshot().map(({ path, content }) => ({ path, content })))
      .then(() => engine)
      .catch((error) => {
        if (nodeEngineRef.current === engine) {
          nodeEngineRef.current = null;
          nodeEngineBootRef.current = null;
        }
        throw error;
      });
    nodeEngineBootRef.current = boot;
    return boot;
  }, [appendNodeTerminal, runtime]);

  const run = useCallback(async () => {
    clearTimeout(autoRunTimer.current);
    try {
      if (mode === 'node') {
        setNodeServer(null);
        const engine = await ensureNodeEngine();
        await engine.start();
      } else {
        await runtime.start();
      }
    } catch (error) {
      if (mode === 'node') {
        appendNodeTerminal({ kind: 'stderr', text: error instanceof Error ? error.message : String(error) });
        setNodeStatus('error');
      }
      // The preview runtime already exposes its formatted errors in the terminal.
    }
  }, [appendNodeTerminal, ensureNodeEngine, mode, runtime]);

  const scheduleRun = useCallback(() => {
    if (!autoRun) return;
    clearTimeout(autoRunTimer.current);
    autoRunTimer.current = setTimeout(run, 650);
  }, [autoRun, run]);

  const handleEditorChange = (value: string) => {
    setEditorValue(value);
    if (activePath) {
      runtime.writeFile(activePath, value);
      if (mode === 'node') void nodeEngineRef.current?.writeFile(activePath, value);
    }
    scheduleRun();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'Enter')) {
      event.preventDefault();
      void run();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = `${editorValue.slice(0, start)}  ${editorValue.slice(end)}`;
      handleEditorChange(value);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const syncEditorScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const executeTerminal = async () => {
    const command = terminalInput.trim();
    if (!command) return;
    setTerminalInput('');
    setHistory((items) => [...items, command]);
    setHistoryIndex(-1);
    if (mode === 'node') {
      try {
        const engine = await ensureNodeEngine();
        const [executable, ...args] = tokenizeCommand(command);
        if (executable) await engine.run(executable, args);
      } catch (error) {
        appendNodeTerminal({ kind: 'stderr', text: error instanceof Error ? error.message : String(error) });
      }
    } else {
      await runtime.runCommand(command);
    }
    syncFiles();
  };

  const handleTerminalHistory = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (!history.length) return;
    const nextIndex = event.key === 'ArrowUp'
      ? Math.min(history.length - 1, historyIndex + 1)
      : Math.max(-1, historyIndex - 1);
    setHistoryIndex(nextIndex);
    setTerminalInput(nextIndex === -1 ? '' : history[history.length - 1 - nextIndex]);
  };

  const switchTemplate = (id: string) => {
    clearTimeout(autoRunTimer.current);
    runtime.loadTemplate(id);
    syncFiles();
    setProgress('Template carregado');
    setNodeServer(null);
    setTimeout(() => {
      if (mode === 'node') {
        void ensureNodeEngine(true).then((engine) => engine.start()).catch((error) => {
          appendNodeTerminal({ kind: 'stderr', text: error instanceof Error ? error.message : String(error) });
          setNodeStatus('error');
        });
      } else {
        void run();
      }
    }, 80);
  };

  const switchMode = (nextMode: NaveboxExecutionMode) => {
    if (nextMode === mode) return;
    clearTimeout(autoRunTimer.current);
    setMode(nextMode);
    setProgress(nextMode === 'node' ? 'Preparando ambiente Node…' : 'Preview WebAssembly');
    if (nextMode === 'node') {
      void ensureNodeEngine().catch((error) => {
        appendNodeTerminal({ kind: 'stderr', text: error instanceof Error ? error.message : String(error) });
        setNodeStatus('error');
      });
    } else if (!snapshot.previewHtml && runtime.currentTemplate.framework !== 'node') {
      setTimeout(() => runtime.start().catch(() => undefined), 50);
    }
  };

  const createFile = () => {
    const path = window.prompt('Caminho do novo arquivo:', '/src/novo-arquivo.ts');
    if (!path) return;
    try {
      runtime.createFile(path);
      if (mode === 'node') void nodeEngineRef.current?.writeFile(path, '');
      syncFiles();
      editorRef.current?.focus();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteActiveFile = () => {
    if (!activePath || activePath === '/package.json') return;
    if (!window.confirm(`Remover ${activePath} do filesystem virtual?`)) return;
    runtime.deleteFile(activePath);
    if (mode === 'node') void nodeEngineRef.current?.deleteFile(activePath);
    syncFiles();
    scheduleRun();
  };

  const exportProject = () => {
    const blob = new Blob([runtime.exportProject()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${runtime.currentTemplate.id}-navebox.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openPreview = () => {
    if (mode === 'node' && nodeServer) {
      window.open(`${nodeServer.url.replace(/\/$/, '')}/`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!snapshot.previewHtml) return;
    const blob = new Blob([snapshot.previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const shellClassName = [
    'nbx-shell',
    previewExpanded ? 'nbx-preview-expanded' : '',
    !explorerOpen ? 'nbx-explorer-closed' : '',
    terminalCollapsed ? 'nbx-terminal-collapsed' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <section className={shellClassName} style={containerStyle}>
      <header className="nbx-topbar">
        <div className="nbx-brand" aria-label="Navebox">
          <LogoIcon />
          <span>navebox</span>
          <b>alpha</b>
        </div>

        <div className="nbx-project-switcher">
          <span className="nbx-project-dot" style={{ background: runtime.currentTemplate.accent }} />
          <select
            aria-label="Selecionar template"
            value={snapshot.templateId}
            onChange={(event) => switchTemplate(event.target.value)}
          >
            {runtime.templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name} · {template.description}</option>
            ))}
          </select>
          <ChevronIcon />
        </div>

        <div className="nbx-runtime-meta">
          <div className="nbx-mode-switch" aria-label="Modo de execução">
            <button className={mode === 'preview' ? 'is-active' : ''} onClick={() => switchMode('preview')} title="Preview leve com bundler WebAssembly">Preview</button>
            <button className={mode === 'node' ? 'is-active' : ''} onClick={() => switchMode('node')} title="Filesystem, npm, processos e servidores Node no navegador">Node</button>
          </div>
          <span className={`nbx-runtime-state is-${visibleStatus}`}><i />{mode === 'node' ? nodeStatusLabel(nodeStatus) : statusLabel(snapshot.status)}</span>
          <span className="nbx-progress-copy">{progress}</span>
        </div>

        <div className="nbx-top-actions">
          <label className="nbx-auto-run" title="Recompilar após editar">
            <input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} />
            <span /> Auto
          </label>
          <IconButton label="Exportar projeto" onClick={exportProject}><DownloadIcon /></IconButton>
          <button className="nbx-run-button" onClick={run} disabled={visibleStatus === 'building'}>
            {visibleStatus === 'building' ? <SpinnerIcon /> : <PlayIcon />}
            {visibleStatus === 'building' ? (mode === 'node' ? 'Booting' : 'Building') : 'Run'}
            <kbd>⌘↵</kbd>
          </button>
        </div>
      </header>

      <div className="nbx-body">
        <aside className="nbx-explorer">
          <div className="nbx-panel-heading">
            <span>EXPLORER</span>
            <div>
              <IconButton label="Novo arquivo" onClick={createFile}><FilePlusIcon /></IconButton>
              <IconButton label="Fechar explorer" onClick={() => setExplorerOpen(false)}><SidebarIcon /></IconButton>
            </div>
          </div>
          <div className="nbx-workspace-label"><ChevronDownIcon /><span>NAVEBOX-PROJECT</span></div>
          <nav className="nbx-file-tree" aria-label="Arquivos do projeto">
            {tree.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`${entry.type === 'directory' ? 'is-directory' : ''} ${entry.path === activePath ? 'is-active' : ''}`}
                style={{ '--file-depth': entry.depth } as CSSProperties}
                onClick={() => entry.type === 'file' && runtime.setActiveFile(entry.path)}
                title={entry.path}
              >
                {entry.type === 'directory' ? <><ChevronDownIcon /><FolderIcon /></> : <FileIcon path={entry.path} />}
                <span>{entry.name}</span>
              </button>
            ))}
          </nav>
          <div className="nbx-explorer-foot">
            <span><PackageIcon /> packages via ESM</span>
            <span><ShieldIcon /> iframe sandbox</span>
          </div>
        </aside>

        <main className="nbx-main">
          <div className="nbx-upper">
            <section className="nbx-editor-panel">
              <div className="nbx-tabbar">
                {!explorerOpen && <IconButton label="Abrir explorer" onClick={() => setExplorerOpen(true)}><SidebarIcon /></IconButton>}
                {activePath ? (
                  <div className="nbx-active-tab">
                    <FileIcon path={activePath} />
                    <span>{basename(activePath)}</span>
                    <i title="Alterações salvas no filesystem virtual" />
                  </div>
                ) : <span className="nbx-no-tab">Nenhum arquivo</span>}
                <div className="nbx-editor-actions">
                  <span>{activeLanguage}</span>
                  <IconButton label="Excluir arquivo" onClick={deleteActiveFile} disabled={!activePath || activePath === '/package.json'}><TrashIcon /></IconButton>
                  <IconButton label="Executar" onClick={run}><RefreshIcon /></IconButton>
                </div>
              </div>

              <div className="nbx-breadcrumbs">
                <span>navebox-project</span>
                {activePath.split('/').filter(Boolean).map((part, index, items) => (
                  <span key={`${part}-${index}`} className={index === items.length - 1 ? 'is-current' : ''}><ChevronIcon />{part}</span>
                ))}
              </div>

              <div className="nbx-code-editor">
                <div className="nbx-line-numbers" ref={lineNumbersRef} aria-hidden="true">
                  {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <textarea
                  ref={editorRef}
                  value={editorValue}
                  onChange={(event) => handleEditorChange(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  onScroll={syncEditorScroll}
                  aria-label={`Editor de ${activePath}`}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={!activePath}
                />
              </div>
              <div className="nbx-editor-statusbar">
                <span>Ln {editorValue.slice(0, editorRef.current?.selectionStart ?? 0).split('\n').length}, Col 1</span>
                <span>Spaces: 2</span><span>UTF-8</span><span>{activeLanguage}</span>
              </div>
            </section>

            <section className="nbx-preview-panel">
              <div className="nbx-preview-toolbar">
                <div className="nbx-traffic-lights"><i /><i /><i /></div>
                <div className="nbx-address">
                  <LockIcon /><span>{mode === 'node' ? 'node.navebox.local' : 'navebox.local'}</span><small>/{snapshot.templateId}</small>
                </div>
                <div className="nbx-preview-actions">
                  <IconButton label="Atualizar preview" onClick={run}><RefreshIcon /></IconButton>
                  <IconButton label="Abrir em nova janela" onClick={openPreview}><ExternalIcon /></IconButton>
                  <IconButton label={previewExpanded ? 'Restaurar painel' : 'Expandir preview'} onClick={() => setPreviewExpanded((value) => !value)}>
                    {previewExpanded ? <CollapseIcon /> : <ExpandIcon />}
                  </IconButton>
                </div>
              </div>

              <div className="nbx-preview-stage">
                {mode === 'node' && nodeServer ? (
                  <iframe
                    ref={iframeRef}
                    key={`node-${nodeServer.port}-${snapshot.templateId}`}
                    title="Preview do servidor Node"
                    src={`${nodeServer.url.replace(/\/$/, '')}/`}
                    sandbox={nodeEngineRef.current?.provider === 'compat'
                      ? 'allow-scripts allow-same-origin allow-modals allow-forms allow-popups'
                      : 'allow-scripts allow-modals allow-forms allow-popups'}
                  />
                ) : mode === 'preview' && snapshot.previewHtml ? (
                  <iframe
                    ref={iframeRef}
                    key={snapshot.buildNumber}
                    title="Preview do projeto"
                    srcDoc={snapshot.previewHtml}
                    sandbox="allow-scripts allow-modals allow-forms allow-popups"
                  />
                ) : (
                  <EmptyPreview
                    status={visibleStatus}
                    error={mode === 'node' ? (nodeStatus === 'error' ? 'Consulte o terminal para ver a falha do ambiente Node.' : null) : snapshot.error}
                    onRun={run}
                  />
                )}
                {visibleStatus === 'building' && (
                  <div className="nbx-build-overlay"><SpinnerIcon /><span>{progress}</span></div>
                )}
              </div>
            </section>
          </div>

          <section className="nbx-terminal-panel">
            <div className="nbx-terminal-tabs">
              <button className="is-active">TERMINAL <span>{visibleTerminalLines.length || ''}</span></button>
              <button disabled>PROBLEMS <span>{snapshot.error ? 1 : 0}</span></button>
              <button disabled>OUTPUT</button>
              <div>
                <span className="nbx-shell-pill"><TerminalIcon /> {mode === 'node' ? 'node-sh' : 'browser-sh'}</span>
                <IconButton label="Limpar terminal" onClick={() => mode === 'node' ? setNodeTerminalLines([]) : runtime.clearTerminal()}><TrashIcon /></IconButton>
                <IconButton label={terminalCollapsed ? 'Expandir terminal' : 'Recolher terminal'} onClick={() => setTerminalCollapsed((value) => !value)}>
                  {terminalCollapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </IconButton>
              </div>
            </div>
            {!terminalCollapsed && (
              <div className="nbx-terminal-body" ref={terminalBodyRef} onClick={() => terminalInputRef.current?.focus()}>
                <div className="nbx-terminal-output">
                  {visibleTerminalLines.map((item) => <TerminalRow key={item.id} line={item} />)}
                </div>
                <form
                  className="nbx-terminal-command"
                  onSubmit={(event) => { event.preventDefault(); void executeTerminal(); }}
                >
                  <span>{mode === 'node' ? 'navebox:/project $' : runtime.shell.prompt}</span>
                  <input
                    ref={terminalInputRef}
                    value={terminalInput}
                    onChange={(event) => setTerminalInput(event.target.value)}
                    onKeyDown={handleTerminalHistory}
                    aria-label="Comando do terminal"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </form>
              </div>
            )}
          </section>
        </main>
      </div>
    </section>
  );
}

function readActiveFile(runtime: NaveboxRuntime): string {
  const path = runtime.state.activeFile;
  return path ? runtime.fileSystem.tryReadFile(path) ?? '' : '';
}

function mapNodeStatus(status: NodeEngineStatus): RuntimeSnapshot['status'] {
  if (status === 'booting' || status === 'installing') return 'building';
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  return 'idle';
}

function nodeStatusLabel(status: NodeEngineStatus): string {
  switch (status) {
    case 'booting': return 'booting';
    case 'installing': return 'npm install';
    case 'running': return 'node online';
    case 'stopped': return 'stopped';
    case 'error': return 'node error';
    default: return 'node idle';
  }
}

function nodeStatusDescription(status: NodeEngineStatus): string {
  switch (status) {
    case 'booting': return 'Inicializando processos e HTTP…';
    case 'installing': return 'Instalando pacotes npm no VFS…';
    case 'running': return 'Servidor Node no navegador';
    case 'error': return 'Falha no ambiente Node';
    case 'stopped': return 'Processos encerrados';
    default: return 'Kernel Node pronto';
  }
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const expression = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(input))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? match[4]).replace(/\\([\\"'` ])/g, '$1'));
  }
  return tokens;
}

function statusLabel(status: RuntimeSnapshot['status']): string {
  switch (status) {
    case 'building': return 'building';
    case 'running': return 'online';
    case 'error': return 'error';
    default: return 'idle';
  }
}

function languageLabel(path: string): string {
  switch (extname(path)) {
    case '.tsx': return 'TypeScript React';
    case '.ts': return 'TypeScript';
    case '.jsx': return 'JavaScript React';
    case '.js': return 'JavaScript';
    case '.json': return 'JSON';
    case '.css': return 'CSS';
    case '.html': return 'HTML';
    default: return 'Plain Text';
  }
}

function TerminalRow({ line }: { line: TerminalLine }) {
  if (line.kind === 'command') {
    const commandStart = line.text.indexOf('$') + 1;
    return <div className="nbx-terminal-row is-command"><b>{line.text.slice(0, commandStart)}</b>{line.text.slice(commandStart)}</div>;
  }
  return <div className={`nbx-terminal-row is-${line.kind}`}>{line.text || '\u00a0'}</div>;
}

function EmptyPreview({
  status,
  error,
  onRun,
}: {
  status: RuntimeSnapshot['status'];
  error: string | null;
  onRun: () => void;
}) {
  return (
    <div className={`nbx-empty-preview is-${status}`}>
      <div><LogoIcon /></div>
      <h3>{error ? 'A compilação parou' : 'Preview aguardando'}</h3>
      <p>{error ?? 'Execute o projeto para iniciar o runtime no navegador.'}</p>
      {!error && <button onClick={onRun}><PlayIcon /> Iniciar runtime</button>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return <button type="button" className="nbx-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function Icon({ children, viewBox = '0 0 24 24' }: { children: ReactNode; viewBox?: string }) {
  return <svg viewBox={viewBox} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

function LogoIcon() { return <svg className="nbx-logo-icon" viewBox="0 0 30 30" aria-hidden="true"><path d="M7 5.5h10.4L24 12v12.5H7z" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M17 5.5V12h7M11 17l2.5 2.5L19 14" fill="none" stroke="currentColor" strokeWidth="2.2"/></svg>; }
function PlayIcon() { return <Icon><path d="m9 7 8 5-8 5z" /></Icon>; }
function SpinnerIcon() { return <svg className="nbx-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2"/><path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>; }
function ChevronIcon() { return <Icon><path d="m9 6 6 6-6 6" /></Icon>; }
function ChevronDownIcon() { return <Icon><path d="m6 9 6 6 6-6" /></Icon>; }
function ChevronUpIcon() { return <Icon><path d="m6 15 6-6 6 6" /></Icon>; }
function DownloadIcon() { return <Icon><path d="M12 3v12m-4-4 4 4 4-4M5 20h14" /></Icon>; }
function FilePlusIcon() { return <Icon><path d="M14 3H6v18h12V7zM14 3v4h4M9 14h6M12 11v6" /></Icon>; }
function SidebarIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16" /></Icon>; }
function FolderIcon() { return <Icon><path d="M3 6.5h7l2 2h9v10H3z" /></Icon>; }
function PackageIcon() { return <Icon><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" /></Icon>; }
function ShieldIcon() { return <Icon><path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6zM9 12l2 2 4-4" /></Icon>; }
function TrashIcon() { return <Icon><path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6M14 11v6" /></Icon>; }
function RefreshIcon() { return <Icon><path d="M20 7v5h-5M4 17v-5h5M18.5 9A7 7 0 0 0 6 7.5L4 12m16 0-2 4.5A7 7 0 0 1 5.5 15" /></Icon>; }
function ExternalIcon() { return <Icon><path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" /></Icon>; }
function ExpandIcon() { return <Icon><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></Icon>; }
function CollapseIcon() { return <Icon><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" /></Icon>; }
function LockIcon() { return <Icon><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>; }
function TerminalIcon() { return <Icon><path d="m5 7 4 4-4 4M11 17h7" /></Icon>; }

function FileIcon({ path }: { path: string }) {
  const extension = extname(path);
  const className = `nbx-file-icon is-${extension.slice(1) || 'file'}`;
  if (extension === '.tsx' || extension === '.jsx') {
    return <span className={className}>⚛</span>;
  }
  if (extension === '.json') return <span className={className}>{'{}'}</span>;
  if (extension === '.css') return <span className={className}>#</span>;
  if (extension === '.html') return <span className={className}>&lt;&gt;</span>;
  if (extension === '.ts' || extension === '.js') return <span className={className}>{extension.slice(1).toUpperCase()}</span>;
  return <span className={className}>·</span>;
}
