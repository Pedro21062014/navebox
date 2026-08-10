export type NaveboxFramework = 'vanilla' | 'react' | 'next' | 'preact' | 'node';

export type FileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'text';

export interface VirtualFile {
  path: string;
  content: string;
  updatedAt: number;
}

export interface FileTreeEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  depth: number;
}

export interface TemplateFile {
  path: string;
  content: string;
}

export interface NaveboxTemplate {
  id: string;
  name: string;
  description: string;
  framework: NaveboxFramework;
  accent: string;
  entryFile: string;
  files: TemplateFile[];
}

export type TerminalLineKind =
  | 'command'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted'
  | 'stdout';

export interface TerminalLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
  timestamp: number;
}

export interface BuildArtifact {
  framework: NaveboxFramework;
  entryPoint: string;
  javascript: string;
  css: string;
  html: string;
  importMap: Record<string, string>;
  duration: number;
  warnings: string[];
}

export interface BuildProgress {
  phase: 'initializing' | 'resolving' | 'compiling' | 'rendering';
  message: string;
}

export interface PackageManifest {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface CompilerOptions {
  cdnBaseUrl?: string;
  /** URL do esbuild.wasm. Por padrão, o binário é carregado sob demanda do unpkg. */
  wasmUrl?: string;
  development?: boolean;
}

export interface NaveboxRuntimeOptions extends CompilerOptions {
  template?: string | NaveboxTemplate;
  persistenceKey?: string | false;
}

export interface RuntimeSnapshot {
  templateId: string;
  framework: NaveboxFramework;
  status: 'idle' | 'building' | 'running' | 'error';
  activeFile: string;
  previewHtml: string;
  buildNumber: number;
  error: string | null;
}

export interface ShellResult {
  lines?: Array<Omit<TerminalLine, 'id' | 'timestamp'>>;
  clear?: boolean;
  cwd?: string;
}

export interface ShellHooks {
  onDev?: () => Promise<void> | void;
  onBuild?: () => Promise<void> | void;
  onReset?: () => Promise<void> | void;
}
