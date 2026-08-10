import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadConfig, type RunnerConfig } from './config.js';
import { KubernetesAdapter, type KubernetesTarget, RunnerContainerAdapter, SshDockerAdapter, type SshDockerTarget } from './deploy/index.js';
import { DockerSandbox } from './sandbox/docker-sandbox.js';
import { ProcessSandbox } from './sandbox/process-sandbox.js';
import { BuildService } from './services/build-service.js';
import { DeploymentService } from './services/deployment-service.js';
import { DeploymentStore } from './services/deployment-store.js';
import { LogBus } from './services/log-bus.js';
import { LogTokenService } from './services/log-token.js';
import { PreviewService } from './services/preview-service.js';
import { WorkspaceStore } from './services/workspace-store.js';
import { LocalArtifactStore } from './storage/local-artifact-store.js';
import { SupabaseArtifactStore } from './storage/supabase-artifact-store.js';
import type { ArtifactStore, SandboxProvider } from './types.js';

const fileSchema = z.object({
  path: z.string().min(1).max(1_024),
  content: z.string().max(8 * 1024 * 1024),
  encoding: z.enum(['utf8', 'base64']).optional(),
});
const commandsSchema = z.object({
  install: z.array(z.string()).min(1).max(32).optional(),
  build: z.array(z.string()).min(1).max(32).optional(),
  start: z.array(z.string()).min(1).max(32).optional(),
}).optional();
const createWorkspaceSchema = z.object({
  name: z.string().max(64).optional(),
  framework: z.string().max(32).optional(),
  files: z.array(fileSchema).min(1).max(1_000),
  commands: commandsSchema,
});
const environmentSchema = z.record(z.string(), z.string().max(32_768)).default({});
const deploySchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(['static', 'container', 'ssh-docker', 'kubernetes']),
  slug: z.string().max(64).optional(),
  target: z.string().max(64).optional(),
  outputDir: z.string().max(256).optional(),
  env: environmentSchema.optional(),
  image: z.string().max(512).optional(),
});

export interface BuildServerOptions {
  config?: RunnerConfig;
  sandbox?: SandboxProvider;
  artifacts?: ArtifactStore;
  logger?: boolean;
}

export interface RunnerServices {
  config: RunnerConfig;
  sandbox: SandboxProvider;
  artifacts: ArtifactStore;
  workspaces: WorkspaceStore;
  previews: PreviewService;
  deployments: DeploymentService;
  logs: LogBus;
  containerAdapter: RunnerContainerAdapter;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance & { services: RunnerServices }> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? config.env !== 'test',
    bodyLimit: 30 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin não permitida.'), false);
    },
    credentials: false,
  });
  await app.register(websocket);

  const sandbox = options.sandbox ?? (config.sandbox === 'process' ? new ProcessSandbox() : new DockerSandbox());
  const artifacts = options.artifacts ?? createArtifactStore(config);
  const logs = new LogBus();
  const workspaces = new WorkspaceStore({ dataDir: config.dataDir, maxWorkspaces: config.maxWorkspaces });
  await workspaces.initialize();
  const previews = new PreviewService(workspaces, sandbox, logs, config);
  const deploymentStore = new DeploymentStore(config.dataDir);
  const buildService = new BuildService(workspaces, sandbox, artifacts, logs);
  const containerAdapter = new RunnerContainerAdapter(sandbox, logs, config);
  const sshAdapter = new SshDockerAdapter(config.sshTargets as Record<string, SshDockerTarget>);
  const kubernetesAdapter = new KubernetesAdapter(config.kubernetesTargets as Record<string, KubernetesTarget>);
  const deployments = new DeploymentService(
    workspaces,
    deploymentStore,
    buildService,
    artifacts,
    logs,
    config,
    [containerAdapter, sshAdapter, kubernetesAdapter],
  );
  const logTokens = new LogTokenService(config.apiToken);
  const services: RunnerServices = { config, sandbox, artifacts, workspaces, previews, deployments, logs, containerAdapter };
  Object.assign(app, { services });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    const logMatch = request.url.match(/^\/v1\/workspaces\/([0-9a-f-]{36})\/logs(?:\?|$)/i);
    if (logMatch) {
      const token = new URL(request.url, 'http://runner.local').searchParams.get('token') ?? undefined;
      if (logTokens.verify(token, logMatch[1])) return;
    }
    if (!validBearer(request.headers.authorization, config.apiToken)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Bearer token ausente ou inválido.' });
    }
  });

  app.get('/', async () => ({
    name: 'Navebox Runner',
    version: '0.2.1',
    docs: '/v1',
    sandbox: sandbox.kind,
    storage: artifacts.kind,
  }));
  app.get('/health', async () => ({ ok: true, sandbox: sandbox.kind, storage: artifacts.kind, time: new Date().toISOString() }));
  app.get('/v1', async () => ({
    endpoints: [
      'POST /v1/workspaces',
      'POST /v1/workspaces/:id/start',
      'POST /v1/workspaces/:id/commands',
      'WS /v1/workspaces/:id/logs',
      'POST /v1/deployments',
    ],
  }));

  app.post('/v1/workspaces', async (request, reply) => {
    const input = createWorkspaceSchema.parse(request.body);
    const workspace = await workspaces.create(input);
    return reply.code(201).send({ workspace });
  });
  app.get('/v1/workspaces', async () => ({ workspaces: await workspaces.list() }));
  app.get('/v1/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await workspaces.get(id);
    return workspace ? { workspace } : reply.code(404).send({ error: 'not_found' });
  });
  app.put('/v1/workspaces/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ files: z.array(fileSchema).min(1).max(1_000) }).parse(request.body);
    await workspaces.require(id);
    await workspaces.writeFiles(id, body.files);
    return { ok: true };
  });
  app.post('/v1/workspaces/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ env: environmentSchema.optional() }).parse(request.body ?? {});
    return previews.start(id, body.env ?? {});
  });
  app.post('/v1/workspaces/:id/stop', async (request) => {
    const { id } = request.params as { id: string };
    return { workspace: await previews.stop(id) };
  });
  app.post('/v1/workspaces/:id/commands', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      command: z.array(z.string().max(4_096)).min(1).max(64),
      timeoutMs: z.number().int().min(100).max(300_000).optional(),
    }).parse(request.body);
    return { result: await previews.execute(id, body.command, body.timeoutMs) };
  });
  app.post('/v1/workspaces/:id/log-token', async (request) => {
    const { id } = request.params as { id: string };
    await workspaces.require(id);
    return { token: logTokens.create(id), expiresIn: 60 };
  });
  app.get('/v1/workspaces/:id/logs', { websocket: true }, (socket, request) => {
    const { id } = request.params as { id: string };
    for (const entry of logs.history(id)) socket.send(JSON.stringify(entry));
    const unsubscribe = logs.subscribe(id, (entry) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(entry));
    });
    socket.on('close', unsubscribe);
  });
  app.delete('/v1/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await previews.remove(id);
    return reply.code(204).send();
  });

  app.post('/v1/deployments', async (request, reply) => {
    const deployment = await deployments.create(deploySchema.parse(request.body));
    return reply.code(201).send({ deployment });
  });
  app.get('/v1/deployments/:id', async (request, reply) => {
    const deployment = await deployments.get((request.params as { id: string }).id);
    return deployment ? { deployment } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/v1/deployments/:id', async (request, reply) => {
    await deployments.remove((request.params as { id: string }).id);
    return reply.code(204).send();
  });

  registerSiteRoutes(app, deployments);
  registerProxyRoutes(app, previews, containerAdapter);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'validation_error', issues: error.issues });
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrad|not found/i.test(message)
      ? 404
      : /insegur|inválid|excede|limite|duplicad/i.test(message)
        ? 400
        : 500;
    if (status >= 500) app.log.error(error);
    const code = status === 404 ? 'not_found' : status === 400 ? 'bad_request' : 'internal_error';
    return reply.code(status).send({ error: code, message });
  });

  const cleanupTimer = setInterval(async () => {
    for (const id of await workspaces.cleanupOlderThan(config.workspaceTtlMs)) await sandbox.stop(id).catch(() => undefined);
  }, Math.min(config.workspaceTtlMs, 15 * 60_000));
  cleanupTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    for (const workspace of await workspaces.list()) await sandbox.stop(workspace.id).catch(() => undefined);
  });

  return app as unknown as FastifyInstance & { services: RunnerServices };
}

function createArtifactStore(config: RunnerConfig): ArtifactStore {
  return config.storage === 'supabase'
    ? new SupabaseArtifactStore(config.supabase)
    : new LocalArtifactStore(config.localArtifactsDir);
}

function registerSiteRoutes(app: FastifyInstance, deployments: DeploymentService): void {
  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string; '*': string };
    const deployment = await deployments.findBySlug(slug);
    if (!deployment) return reply.code(404).type('text/plain').send('Deployment não encontrado.');
    const path = (request.params as { '*': string })['*'] || 'index.html';
    const artifact = await deployments.getStaticArtifact(deployment, path);
    if (!artifact) return reply.code(404).type('text/plain').send('Arquivo não encontrado.');
    const cache = artifact.contentType.startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable';
    return reply.header('Cache-Control', cache).type(artifact.contentType).send(Buffer.from(artifact.data));
  };
  app.get('/sites/:slug', async (request, reply) => reply.redirect(`/sites/${(request.params as { slug: string }).slug}/`));
  app.get('/sites/:slug/', serve);
  app.get('/sites/:slug/*', serve);
}

function registerProxyRoutes(app: FastifyInstance, previews: PreviewService, containers: RunnerContainerAdapter): void {
  const previewProxy = (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return proxyToPort(request, reply, previews.getPort(workspaceId), (request.params as { '*': string })['*']);
  };
  const appProxy = (request: FastifyRequest, reply: FastifyReply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    return proxyToPort(request, reply, containers.getPort(deploymentId), (request.params as { '*': string })['*']);
  };
  app.all('/preview/:workspaceId/', previewProxy);
  app.all('/preview/:workspaceId/*', previewProxy);
  app.all('/apps/:deploymentId/', appProxy);
  app.all('/apps/:deploymentId/*', appProxy);
}

async function proxyToPort(request: FastifyRequest, reply: FastifyReply, port: number | undefined, wildcard = '') {
  if (!port) return reply.code(404).send({ error: 'not_running' });
  const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
  const target = `http://127.0.0.1:${port}/${wildcard ?? ''}${query}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined && !['host', 'connection', 'content-length'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  let body: string | Buffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method) && request.body !== undefined) {
    body = Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
  }
  const response = await fetch(target, { method: request.method, headers, body, redirect: 'manual' });
  response.headers.forEach((value, key) => {
    if (!['connection', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key)) reply.header(key, value);
  });
  return reply.code(response.status).send(Buffer.from(await response.arrayBuffer()));
}

function validBearer(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}
