import { basename, normalizePath } from './path';
import type { PackageManifest, ShellHooks, ShellResult, TerminalLineKind } from './types';
import { VirtualFileSystem } from './virtual-file-system';

type OutputLine = { kind: TerminalLineKind; text: string };

const HELP = [
  ['help', 'lista os comandos disponíveis'],
  ['ls [dir]', 'lista arquivos e diretórios'],
  ['tree [dir]', 'exibe a árvore do projeto'],
  ['cat <arquivo>', 'mostra o conteúdo de um arquivo'],
  ['cd <dir>', 'altera o diretório atual'],
  ['mkdir [-p] <dir>', 'cria um diretório virtual'],
  ['touch <arquivo>', 'cria um arquivo vazio'],
  ['echo <texto> > <arquivo>', 'grava conteúdo em um arquivo'],
  ['rm [-r] <caminho>', 'remove arquivo ou diretório'],
  ['mv <origem> <destino>', 'move ou renomeia um caminho'],
  ['npm install [pacote]', 'registra dependências ESM no package.json'],
  ['npm run dev', 'compila e abre o preview'],
  ['npm run build', 'executa uma compilação de produção'],
  ['node -e <código>', 'executa JavaScript em um Worker isolado'],
  ['clear', 'limpa o terminal'],
];

export class NaveboxShell {
  cwd = '/';

  constructor(
    private readonly fileSystem: VirtualFileSystem,
    private readonly hooks: ShellHooks = {},
  ) {}

  get prompt(): string {
    const folder = this.cwd === '/' ? '~' : basename(this.cwd);
    return `navebox:${folder} $`;
  }

  async execute(rawInput: string): Promise<ShellResult> {
    const input = rawInput.trim();
    if (!input) return {};

    try {
      const echoResult = this.handleEchoRedirection(input);
      if (echoResult) return echoResult;

      const tokens = tokenize(input);
      const command = tokens.shift()?.toLowerCase();
      const args = tokens;

      switch (command) {
        case 'help': return { lines: HELP.map(([name, description]) => line('stdout', `${name.padEnd(26)} ${description}`)) };
        case 'clear': return { clear: true };
        case 'pwd': return { lines: [line('stdout', this.cwd)] };
        case 'ls': return this.list(args);
        case 'tree': return this.tree(args);
        case 'cat': return this.cat(args);
        case 'cd': return this.changeDirectory(args);
        case 'mkdir': return this.makeDirectory(args);
        case 'touch': return this.touch(args);
        case 'rm': return this.remove(args);
        case 'mv': return this.move(args);
        case 'npm':
        case 'pnpm':
        case 'yarn': return await this.npm(args);
        case 'node': return await this.node(args);
        case 'whoami': return { lines: [line('stdout', 'browser') ] };
        case 'date': return { lines: [line('stdout', new Date().toString())] };
        case 'reset':
          await this.hooks.onReset?.();
          return { lines: [line('success', 'Projeto restaurado para o template inicial.')] };
        default:
          return { lines: [line('error', `${command}: comando não encontrado. Digite “help”.`)] };
      }
    } catch (error) {
      return { lines: [line('error', error instanceof Error ? error.message : String(error))] };
    }
  }

  private list(args: string[]): ShellResult {
    const pathArg = args.find((arg) => !arg.startsWith('-')) ?? '.';
    const path = normalizePath(pathArg, this.cwd);
    if (this.fileSystem.isFile(path)) return { lines: [line('stdout', basename(path))] };
    const entries = this.fileSystem.listDirectory(path);
    if (!entries.length) return { lines: [line('muted', '(diretório vazio)')] };
    return {
      lines: entries.map((entry) => line(entry.type === 'directory' ? 'info' : 'stdout', `${entry.name}${entry.type === 'directory' ? '/' : ''}`)),
    };
  }

  private tree(args: string[]): ShellResult {
    const pathArg = args.find((arg) => !arg.startsWith('-')) ?? '.';
    const root = normalizePath(pathArg, this.cwd);
    const entries = this.fileSystem.list(root);
    const rows: OutputLine[] = [line('stdout', root === '/' ? '.' : basename(root))];
    entries.forEach((entry, index) => {
      const next = entries[index + 1];
      const isLastAtDepth = !next || next.depth < entry.depth || (next.depth === entry.depth && index === entries.length - 1);
      const branch = isLastAtDepth ? '└──' : '├──';
      rows.push(line(entry.type === 'directory' ? 'info' : 'stdout', `${'    '.repeat(entry.depth)}${branch} ${entry.name}${entry.type === 'directory' ? '/' : ''}`));
    });
    return { lines: rows };
  }

  private cat(args: string[]): ShellResult {
    if (!args[0]) throw new Error('Uso: cat <arquivo>');
    const path = normalizePath(args[0], this.cwd);
    const content = this.fileSystem.readFile(path);
    return { lines: content.split('\n').map((text) => line('stdout', text)) };
  }

  private changeDirectory(args: string[]): ShellResult {
    const destination = normalizePath(args[0] ?? '/', this.cwd);
    if (!this.fileSystem.isDirectory(destination)) throw new Error(`cd: diretório não encontrado: ${destination}`);
    this.cwd = destination;
    return { cwd: destination };
  }

  private makeDirectory(args: string[]): ShellResult {
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (!paths.length) throw new Error('Uso: mkdir [-p] <diretório>');
    paths.forEach((path) => this.fileSystem.mkdir(normalizePath(path, this.cwd)));
    return {};
  }

  private touch(args: string[]): ShellResult {
    if (!args.length) throw new Error('Uso: touch <arquivo>');
    for (const path of args) {
      const normalized = normalizePath(path, this.cwd);
      if (!this.fileSystem.exists(normalized)) this.fileSystem.writeFile(normalized, '');
    }
    return {};
  }

  private remove(args: string[]): ShellResult {
    const recursive = args.some((arg) => /^-[a-z]*r/.test(arg));
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (!paths.length) throw new Error('Uso: rm [-r] <caminho>');
    paths.forEach((path) => this.fileSystem.delete(normalizePath(path, this.cwd), recursive));
    return {};
  }

  private move(args: string[]): ShellResult {
    if (args.length !== 2) throw new Error('Uso: mv <origem> <destino>');
    this.fileSystem.move(normalizePath(args[0], this.cwd), normalizePath(args[1], this.cwd));
    return {};
  }

  private handleEchoRedirection(input: string): ShellResult | undefined {
    const match = input.match(/^echo(?:\s+)(.*?)(?:\s*)(>>|>)(?:\s*)(\S+)$/s);
    if (!match) return undefined;
    const [, rawContent, operator, rawPath] = match;
    const path = normalizePath(rawPath, this.cwd);
    const content = unquote(rawContent).replaceAll('\\n', '\n');
    const previous = operator === '>>' ? (this.fileSystem.tryReadFile(path) ?? '') : '';
    this.fileSystem.writeFile(path, `${previous}${content}\n`);
    return {};
  }

  private async npm(args: string[]): Promise<ShellResult> {
    const subcommand = args.shift();
    if (!subcommand) return { lines: [line('stdout', 'Navebox package bridge 0.2.0')] };

    if (subcommand === 'install' || subcommand === 'i' || subcommand === 'add') {
      return this.installPackages(args.filter((arg) => !arg.startsWith('-')));
    }

    if (subcommand === 'run' || subcommand === 'run-script') {
      const script = args[0];
      if (!script) throw new Error('Uso: npm run <script>');
      if (script === 'dev' || script === 'start') {
        await this.hooks.onDev?.();
        return { lines: [line('success', 'Servidor virtual disponível no painel Preview.')] };
      }
      if (script === 'build') {
        await this.hooks.onBuild?.();
        return { lines: [line('success', 'Build concluído sem gravar artefatos no dispositivo.')] };
      }
      const manifest = this.readManifest();
      if (!manifest.scripts?.[script]) throw new Error(`npm: script “${script}” não encontrado.`);
      return { lines: [line('warning', `O script “${script}” usa uma CLI não disponível neste runtime leve.`)] };
    }

    if (subcommand === '--version' || subcommand === '-v') return { lines: [line('stdout', '10.8.2-browser')] };
    throw new Error(`npm: subcomando não suportado: ${subcommand}`);
  }

  private installPackages(packages: string[]): ShellResult {
    const manifest = this.readManifest();
    const dependencies = { ...(manifest.dependencies ?? {}) };

    if (!packages.length) {
      const count = Object.keys(dependencies).length;
      return {
        lines: [
          line('info', `Resolvendo ${count} dependência${count === 1 ? '' : 's'} pelo registry ESM…`),
          line('success', `✓ ${count} pacote${count === 1 ? '' : 's'} pronto${count === 1 ? '' : 's'} (cache sob demanda)`),
        ],
      };
    }

    for (const request of packages) {
      const { name, version } = parsePackageRequest(request);
      dependencies[name] = version;
    }
    manifest.dependencies = dependencies;
    this.fileSystem.writeFile('/package.json', `${JSON.stringify(manifest, null, 2)}\n`);

    return {
      lines: [
        line('info', `Atualizando import map para ${packages.join(', ')}…`),
        line('success', `+ ${packages.length} dependência${packages.length === 1 ? '' : 's'} adicionada${packages.length === 1 ? '' : 's'}`),
        line('muted', 'Os módulos serão baixados no iframe apenas quando importados.'),
      ],
    };
  }

  private async node(args: string[]): Promise<ShellResult> {
    if (args[0] === '--version' || args[0] === '-v') return { lines: [line('stdout', 'v20-browser-worker')] };
    let source: string;
    if (args[0] === '-e' || args[0] === '--eval') {
      source = args.slice(1).join(' ');
      if (!source) throw new Error('Uso: node -e <código>');
    } else if (args[0]) {
      source = this.fileSystem.readFile(normalizePath(args[0], this.cwd));
    } else {
      throw new Error('REPL interativo ainda não disponível. Use node -e <código>.');
    }
    const output = await executeInWorker(source);
    return { lines: output.map((text) => line('stdout', text)) };
  }

  private readManifest(): PackageManifest {
    const raw = this.fileSystem.tryReadFile('/package.json') ?? '{}';
    try {
      return JSON.parse(raw) as PackageManifest;
    } catch {
      throw new Error('package.json inválido. Corrija o JSON antes de instalar pacotes.');
    }
  }
}

function line(kind: TerminalLineKind, text: string): OutputLine {
  return { kind, text };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const expression = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(input))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? match[4]).replace(/\\([\\"'` ])/g, '$1'));
  }
  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  if ((first === '"' || first === "'") && trimmed.at(-1) === first) return trimmed.slice(1, -1);
  return trimmed;
}

function parsePackageRequest(request: string): { name: string; version: string } {
  if (!request || request.startsWith('-')) throw new Error(`Pacote inválido: ${request}`);
  const splitAt = request.lastIndexOf('@');
  const hasVersion = request.startsWith('@') ? splitAt > request.indexOf('/') : splitAt > 0;
  const name = hasVersion ? request.slice(0, splitAt) : request;
  const version = hasVersion ? request.slice(splitAt + 1) : 'latest';
  if (!name || !version) throw new Error(`Pacote inválido: ${request}`);
  return { name, version };
}

async function executeInWorker(source: string): Promise<string[]> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Workers não estão disponíveis neste ambiente.');
  }

  const workerSource = `
    const format = (value) => typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
    console.log = (...args) => postMessage({ type: 'output', text: args.map(format).join(' ') });
    console.info = console.log;
    console.warn = console.log;
    console.error = console.log;
    Promise.resolve().then(() => (0, eval)(${JSON.stringify(source)})).then(
      (value) => { if (value !== undefined) postMessage({ type: 'output', text: format(value) }); postMessage({ type: 'done' }); },
      (error) => postMessage({ type: 'error', text: error?.stack || String(error) }),
    );`;
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(url);

  return await new Promise<string[]>((resolve, reject) => {
    const lines: string[] = [];
    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error('Processo encerrado após 3 segundos.'));
    }, 3000);

    worker.onmessage = (event: MessageEvent<{ type: string; text?: string }>) => {
      if (event.data.type === 'output') lines.push(event.data.text ?? '');
      if (event.data.type === 'error') {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(new Error(event.data.text ?? 'Erro no Worker.'));
      }
      if (event.data.type === 'done') {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(lines.length ? lines : ['(processo finalizado sem saída)']);
      }
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(event.message));
    };
  });
}
