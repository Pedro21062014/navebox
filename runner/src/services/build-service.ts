import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ArtifactStore, SandboxProvider, WorkspaceRecord } from '../types.js';
import { contentTypeForPath } from '../util/content-type.js';
import { LogBus } from './log-bus.js';
import { WorkspaceStore } from './workspace-store.js';

export interface StaticBuildResult {
  outputDir: string;
  artifactPrefix: string;
  artifacts: Array<{ key: string; size: number; contentType: string }>;
  totalBytes: number;
}

export class BuildService {
  constructor(
    private readonly workspaces: WorkspaceStore,
    private readonly sandbox: SandboxProvider,
    private readonly artifacts: ArtifactStore,
    private readonly logs: LogBus,
  ) {}

  async buildStatic(
    workspace: WorkspaceRecord,
    deploymentId: string,
    requestedOutputDir?: string,
  ): Promise<StaticBuildResult> {
    const cwd = this.workspaces.pathFor(workspace.id);
    const onLog = (stream: 'stdout' | 'stderr', text: string) => this.logs.publish(workspace.id, stream, text);

    if (workspace.commands.install) {
      this.logs.publish(workspace.id, 'system', `> ${workspace.commands.install.join(' ')}\n`);
      const install = await this.sandbox.exec({
        workspaceId: `${workspace.id}-deploy-install`,
        cwd,
        command: workspace.commands.install,
        timeoutMs: 300_000,
        onLog,
      });
      if (install.exitCode !== 0) throw new Error(`Instalação de deploy falhou (exit ${install.exitCode}).`);
    }
    if (workspace.commands.build) {
      this.logs.publish(workspace.id, 'system', `> ${workspace.commands.build.join(' ')}\n`);
      const build = await this.sandbox.exec({
        workspaceId: `${workspace.id}-deploy-build`,
        cwd,
        command: workspace.commands.build,
        timeoutMs: 300_000,
        onLog,
      });
      if (build.exitCode !== 0) throw new Error(`Build falhou (exit ${build.exitCode}).`);
    }

    const outputDir = await locateOutputDirectory(cwd, requestedOutputDir);
    const files = await collectFiles(outputDir);
    if (!files.some((path) => basename(path).toLowerCase() === 'index.html')) {
      throw new Error(`Build estático não contém index.html em ${relative(cwd, outputDir) || '.'}.`);
    }

    const artifactPrefix = `deployments/${deploymentId}/site`;
    const artifacts: StaticBuildResult['artifacts'] = [];
    let totalBytes = 0;
    for (const filePath of files) {
      const key = `${artifactPrefix}/${relative(outputDir, filePath).split(sep).join('/')}`;
      const data = await readFile(filePath);
      totalBytes += data.byteLength;
      if (totalBytes > 150 * 1024 * 1024) throw new Error('Build excede o limite de 150 MiB.');
      const contentType = contentTypeForPath(filePath);
      await this.artifacts.put(key, data, contentType);
      artifacts.push({ key, size: data.byteLength, contentType });
    }
    const manifest = Buffer.from(JSON.stringify({ version: 1, deploymentId, files: artifacts }, null, 2));
    await this.artifacts.put(`deployments/${deploymentId}/manifest.json`, manifest, 'application/json; charset=utf-8');
    return { outputDir, artifactPrefix, artifacts, totalBytes };
  }
}

async function locateOutputDirectory(workspaceDir: string, requested?: string): Promise<string> {
  if (requested) {
    const output = resolve(workspaceDir, requested);
    assertInside(workspaceDir, output);
    if (await isDirectory(output)) return output;
    throw new Error(`Diretório de build não encontrado: ${requested}`);
  }
  for (const candidate of ['dist', 'out', 'build', '.output/public', 'public', '.']) {
    const output = resolve(workspaceDir, candidate);
    if (await isDirectory(output) && await containsIndex(output)) return output;
  }
  throw new Error('Não encontrei um output estático (dist, out, build, .output/public ou public).');
}

async function collectFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.navebox') continue;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
      if (output.length > 10_000) throw new Error('Build excede 10.000 arquivos.');
    }
  };
  await visit(root);
  return output.sort();
}

async function containsIndex(directory: string): Promise<boolean> {
  try {
    return (await stat(resolve(directory, 'index.html'))).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

function assertInside(root: string, destination: string): void {
  const relation = relative(root, destination);
  if (relation.startsWith('..') || isAbsolute(relation)) throw new Error('Output de build fora do workspace.');
}
