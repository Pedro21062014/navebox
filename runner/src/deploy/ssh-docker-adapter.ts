import { access, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeployAdapter, DeploymentContext, DeploymentRecord } from '../types.js';
import { runProcess } from '../util/process.js';

export interface SshDockerTarget {
  host: string;
  user: string;
  port?: number;
  baseDir?: string;
  publicBaseUrl?: string;
  identityFile?: string;
  dockerNetwork?: string;
  ingressDomain?: string;
}

export class SshDockerAdapter implements DeployAdapter {
  readonly kind = 'ssh-docker' as const;

  constructor(
    private readonly targets: Record<string, SshDockerTarget>,
    private readonly sshBinary = 'ssh',
    private readonly scpBinary = 'scp',
  ) {}

  async deploy(context: DeploymentContext): Promise<{ url: string }> {
    const targetId = context.deployment.target;
    const target = targetId ? this.targets[targetId] : undefined;
    if (!target || !targetId) throw new Error(`Target SSH não configurado: ${targetId ?? '(vazio)'}`);
    validateTarget(target);
    await ensureDockerfile(context.workspaceDir);

    const remote = `${target.user}@${target.host}`;
    const remoteDir = `${target.baseDir ?? '/opt/navebox'}/${context.deployment.id}`;
    const common = sshOptions(target);
    const mkdirResult = await runProcess(this.sshBinary, [...common, remote, `mkdir -p ${shellQuote(remoteDir)}`], { timeoutMs: 30_000 });
    if (mkdirResult.exitCode !== 0) throw new Error(`SSH mkdir falhou: ${mkdirResult.stderr}`);
    const copyResult = await runProcess(this.scpBinary, [
      ...scpOptions(target), '-r', `${context.workspaceDir}/.`, `${remote}:${remoteDir}/`,
    ], { timeoutMs: 300_000 });
    if (copyResult.exitCode !== 0) throw new Error(`SCP falhou: ${copyResult.stderr}`);

    const name = `navebox-${context.deployment.slug}`;
    const image = `navebox/${context.deployment.slug}:${context.deployment.id.slice(0, 8)}`;
    const port = 30_000 + hash(context.deployment.id) % 10_000;
    const environment = Object.entries(context.env).map(([key, value]) => `-e ${shellQuote(`${key}=${value}`)}`).join(' ');
    const routing = target.ingressDomain
      ? `--network ${shellQuote(target.dockerNetwork ?? 'web')} -l traefik.enable=true -l ${shellQuote(`traefik.http.routers.${name}.rule=Host(\`${context.deployment.slug}.${target.ingressDomain}\`)`)} -l ${shellQuote(`traefik.http.services.${name}.loadbalancer.server.port=3000`)}`
      : `-p ${port}:3000`;
    const script = `set -eu
cd ${shellQuote(remoteDir)}
docker build -f .navebox.Dockerfile -t ${shellQuote(image)} .
docker rm -f ${shellQuote(name)} >/dev/null 2>&1 || true
docker run -d --name ${shellQuote(name)} --restart unless-stopped --cap-drop ALL --security-opt no-new-privileges ${routing} ${environment} ${shellQuote(image)}
`;
    const deployResult = await runProcess(this.sshBinary, [...common, remote, 'sh -se'], {
      input: script,
      timeoutMs: 600_000,
    });
    if (deployResult.exitCode !== 0) throw new Error(`Deploy SSH falhou: ${deployResult.stderr || deployResult.stdout}`);
    const url = target.ingressDomain
      ? `https://${context.deployment.slug}.${target.ingressDomain}/`
      : `${(target.publicBaseUrl ?? `http://${target.host}`).replace(/\/$/, '')}:${port}/`;
    return { url };
  }

  async remove(deployment: DeploymentRecord): Promise<void> {
    const target = deployment.target ? this.targets[deployment.target] : undefined;
    if (!target) return;
    const remote = `${target.user}@${target.host}`;
    const name = `navebox-${deployment.slug}`;
    await runProcess(this.sshBinary, [...sshOptions(target), remote, `docker rm -f ${shellQuote(name)}`], { timeoutMs: 30_000 }).catch(() => undefined);
  }
}

async function ensureDockerfile(workspaceDir: string): Promise<void> {
  const projectDockerfile = resolve(workspaceDir, 'Dockerfile');
  try {
    await access(projectDockerfile);
    await copyFile(projectDockerfile, resolve(workspaceDir, '.navebox.Dockerfile'));
    return;
  } catch {
    // Generate a conventional Node production image.
  }
  await writeFile(resolve(workspaceDir, '.navebox.Dockerfile'), `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build --if-present
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "run", "start"]
`);
}

function validateTarget(target: SshDockerTarget): void {
  if (!/^[a-z0-9._-]+$/i.test(target.host)) throw new Error('Host SSH inválido.');
  if (!/^[a-z_][a-z0-9_-]*$/i.test(target.user)) throw new Error('Usuário SSH inválido.');
  if (target.port && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) throw new Error('Porta SSH inválida.');
  if (target.ingressDomain && !/^[a-z0-9.-]+$/i.test(target.ingressDomain)) throw new Error('Domínio de ingress inválido.');
}

function sshOptions(target: SshDockerTarget): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(target.port ?? 22), ...(target.identityFile ? ['-i', target.identityFile] : [])];
}
function scpOptions(target: SshDockerTarget): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-P', String(target.port ?? 22), ...(target.identityFile ? ['-i', target.identityFile] : [])];
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function hash(value: string): number { return [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0); }
