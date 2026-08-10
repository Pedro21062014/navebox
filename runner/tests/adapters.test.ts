import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KubernetesAdapter } from '../src/deploy/kubernetes-adapter.js';
import { RunnerContainerAdapter } from '../src/deploy/runner-container-adapter.js';
import { SshDockerAdapter } from '../src/deploy/ssh-docker-adapter.js';
import { LogBus } from '../src/services/log-bus.js';
import type { DeploymentContext, SandboxProvider } from '../src/types.js';
import { tempDirectory, testConfig } from './helpers.js';

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function fakeBinary(dir: string, name: string) {
  const path = `${dir}/${name}`;
  await writeFile(path, `#!/bin/sh\necho "$0 $@" >> "${dir}/calls.log"\ncat >> "${dir}/stdin.log"\nexit 0\n`);
  await chmod(path, 0o755);
  return path;
}

function context(workspaceDir: string, kind: 'container' | 'ssh-docker' | 'kubernetes', target = 'prod'): DeploymentContext {
  const now = new Date().toISOString();
  return {
    deployment: { id: '12345678-1234-1234-1234-123456789abc', workspaceId: '87654321-1234-1234-1234-123456789abc', slug: 'my-app', kind, target, status: 'deploying', createdAt: now, updatedAt: now },
    workspace: { id: '87654321-1234-1234-1234-123456789abc', name: 'my-app', framework: 'next', status: 'stopped', createdAt: now, updatedAt: now, commands: {} },
    workspaceDir,
    env: { API_MODE: 'production' },
  };
}

describe('deployment adapters', () => {
  it('gera e aplica manifesto Kubernetes endurecido', async () => {
    const dir = await tempDirectory('navebox-kube-'); dirs.push(dir);
    const kubectl = await fakeBinary(dir, 'kubectl');
    const adapter = new KubernetesAdapter({ prod: { namespace: 'apps', ingressDomain: 'example.com', replicas: 2 } }, kubectl);
    const result = await adapter.deploy({ ...context(dir, 'kubernetes'), image: 'ghcr.io/pedrobef/app:sha' });
    const manifest = JSON.parse(await readFile(`${dir}/stdin.log`, 'utf8'));
    expect(result.url).toBe('https://my-app.example.com/');
    expect(manifest.kind).toBe('List');
    expect(manifest.items[0].spec.replicas).toBe(2);
    expect(manifest.items[0].spec.template.spec.containers[0].securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true });
  });

  it('exige imagem OCI para Kubernetes', async () => {
    const adapter = new KubernetesAdapter({ prod: { ingressDomain: 'example.com' } }, '/bin/true');
    await expect(adapter.deploy(context('/tmp', 'kubernetes'))).rejects.toThrow('imagem OCI');
  });

  it('prepara Dockerfile e fluxo SSH sem interpolar target inválido', async () => {
    const dir = await tempDirectory('navebox-ssh-'); dirs.push(dir);
    await writeFile(`${dir}/package.json`, '{"scripts":{"start":"next start"}}');
    const ssh = await fakeBinary(dir, 'ssh');
    const scp = await fakeBinary(dir, 'scp');
    const adapter = new SshDockerAdapter({
      prod: { host: 'server.example', user: 'deploy', baseDir: '/opt/apps', publicBaseUrl: 'https://apps.example' },
    }, ssh, scp);
    const result = await adapter.deploy(context(dir, 'ssh-docker'));
    expect(result.url).toMatch(/^https:\/\/apps\.example:\d+\/$/);
    expect(await readFile(`${dir}/.navebox.Dockerfile`, 'utf8')).toContain('FROM node:20-alpine');
    expect(await readFile(`${dir}/calls.log`, 'utf8')).toContain('server.example');
  });

  it('container adapter instala, faz build e só então inicia produção', async () => {
    const dir = await tempDirectory('navebox-container-'); dirs.push(dir);
    await writeFile(`${dir}/package.json`, '{"scripts":{"start":"node server.js"}}');
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }));
    const start = vi.fn(async () => ({ port: 3210 }));
    const sandbox = {
      kind: 'process', exec, start,
      stop: vi.fn(async () => undefined), isRunning: () => false, getPort: () => undefined,
    } satisfies SandboxProvider;
    const adapter = new RunnerContainerAdapter(sandbox, new LogBus(), testConfig(dir));
    const ctx = context(dir, 'container');
    ctx.workspace.commands = { install: ['npm', 'ci'], build: ['npm', 'run', 'build'] };
    const result = await adapter.deploy(ctx);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledAfter(exec);
    expect(result.url).toContain('/apps/');
  });

  it('rejeita host SSH potencialmente injetável', async () => {
    const dir = await tempDirectory('navebox-ssh-bad-'); dirs.push(dir);
    const adapter = new SshDockerAdapter({ prod: { host: 'host;rm -rf /', user: 'deploy' } }, '/bin/true', '/bin/true');
    await expect(adapter.deploy(context(dir, 'ssh-docker'))).rejects.toThrow('Host SSH inválido');
  });
});
