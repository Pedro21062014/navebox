import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  NAVEBOX_PUBLIC_ORIGIN: z.string().url().default('http://localhost:8787'),
  NAVEBOX_API_TOKEN: z.string().min(24).default('development-token-change-me'),
  NAVEBOX_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  NAVEBOX_SANDBOX: z.enum(['docker', 'process']).default('docker'),
  NAVEBOX_DATA_DIR: z.string().default('./data'),
  NAVEBOX_LOCAL_ARTIFACTS: z.string().default('./data/artifacts'),
  NAVEBOX_MAX_WORKSPACES: z.coerce.number().int().min(1).max(500).default(20),
  NAVEBOX_WORKSPACE_TTL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  NAVEBOX_MEMORY_MB: z.coerce.number().int().min(128).max(8192).default(768),
  NAVEBOX_CPU_LIMIT: z.coerce.number().min(0.1).max(8).default(1),
  NAVEBOX_PREVIEW_DOMAIN: z.string().default(''),
  NAVEBOX_STORAGE: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_BUCKET: z.string().default('navebox-deployments'),
  SUPABASE_PUBLIC_BUCKET: z.string().default('true'),
  NAVEBOX_SSH_TARGETS: z.string().default('{}'),
  NAVEBOX_KUBERNETES_TARGETS: z.string().default('{}'),
});

export type RunnerConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(source);
  if (env.NODE_ENV === 'production' && env.NAVEBOX_API_TOKEN === 'development-token-change-me') {
    throw new Error('Defina NAVEBOX_API_TOKEN com um segredo forte em produção.');
  }
  if (env.NODE_ENV === 'production' && env.NAVEBOX_SANDBOX === 'process') {
    throw new Error('NAVEBOX_SANDBOX=process é bloqueado em produção. Use docker.');
  }
  if (env.NAVEBOX_STORAGE === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para storage Supabase.');
  }

  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    publicOrigin: env.NAVEBOX_PUBLIC_ORIGIN.replace(/\/$/, ''),
    apiToken: env.NAVEBOX_API_TOKEN,
    allowedOrigins: env.NAVEBOX_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean),
    sandbox: env.NAVEBOX_SANDBOX,
    dataDir: resolve(env.NAVEBOX_DATA_DIR),
    localArtifactsDir: resolve(env.NAVEBOX_LOCAL_ARTIFACTS),
    maxWorkspaces: env.NAVEBOX_MAX_WORKSPACES,
    workspaceTtlMs: env.NAVEBOX_WORKSPACE_TTL_MS,
    limits: {
      memoryMb: env.NAVEBOX_MEMORY_MB,
      cpuLimit: env.NAVEBOX_CPU_LIMIT,
      pidsLimit: 128,
      timeoutMs: 120_000,
    },
    previewDomain: env.NAVEBOX_PREVIEW_DOMAIN,
    storage: env.NAVEBOX_STORAGE,
    supabase: {
      url: env.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_BUCKET,
      publicBucket: env.SUPABASE_PUBLIC_BUCKET === 'true',
    },
    sshTargets: parseObject(env.NAVEBOX_SSH_TARGETS, 'NAVEBOX_SSH_TARGETS'),
    kubernetesTargets: parseObject(env.NAVEBOX_KUBERNETES_TARGETS, 'NAVEBOX_KUBERNETES_TARGETS'),
  };
}

function parseObject(value: string, name: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('esperado objeto JSON');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${name} inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}
