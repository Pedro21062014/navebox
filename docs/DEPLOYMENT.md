# Navebox deployment architecture

Navebox has two independent deployment paths:

1. **Static:** the Runner executes the real project build, uploads the output to Local Storage or Supabase Storage, and serves it through the SPA-aware gateway at `/sites/:slug/`.
2. **Dynamic:** Node/Next SSR and APIs are started by one of the `container`, `ssh-docker`, or `kubernetes` adapters.

A database stores files; it does not execute an HTTP server. For this reason, Supabase is used for durable build artifacts while dynamic APIs use an execution adapter.

## Start the Runner

```bash
cd runner
cp .env.example .env
# Set a long random NAVEBOX_API_TOKEN.
docker compose --env-file .env up -d --build
curl http://localhost:8787/health
```

The provided Compose file uses a separate Docker-in-Docker daemon. Generated code never receives the Docker socket. Each preview gets memory, CPU, PID, capability and `no-new-privileges` limits.

## Supabase Storage

Create a public bucket named `navebox-deployments`, or run in the Supabase SQL editor:

```sql
insert into storage.buckets (id, name, public)
values ('navebox-deployments', 'navebox-deployments', true)
on conflict (id) do update set public = excluded.public;
```

Set only on the Runner — never in browser code:

```dotenv
NAVEBOX_STORAGE=supabase
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=navebox-deployments
```

The gateway still provides clean routes and an `index.html` fallback. Assets receive immutable cache headers; HTML is `no-cache`.

## Deploy from an application

```ts
import { NaveboxCloudClient } from '@pedrobef/navebox';

const cloud = new NaveboxCloudClient({
  endpoint: 'https://runner.example.com',
  token: () => getShortLivedUserToken(),
});

const { deployment } = await cloud.deployProject({
  name: 'my-app',
  framework: 'react',
  files,
  kind: 'static',
  outputDir: 'dist',
  commands: {
    install: ['npm', 'ci'],
    build: ['npm', 'run', 'build'],
  },
});

console.log(deployment.url);
```

## Dynamic adapters

### Runner container

`kind: "container"` builds/starts the production command on the Runner and proxies `/apps/:deploymentId/*`.

### SSH + Docker

Configure credentials on the Runner, not in a browser request:

```dotenv
NAVEBOX_SSH_TARGETS={"production":{"host":"server.example.com","user":"deploy","port":22,"baseDir":"/opt/navebox","ingressDomain":"apps.example.com","dockerNetwork":"web"}}
```

Then request `{ kind: "ssh-docker", target: "production" }`. The adapter uploads the project, creates a constrained container and can attach Traefik labels.

### Kubernetes

```dotenv
NAVEBOX_KUBERNETES_TARGETS={"production":{"namespace":"navebox","ingressDomain":"apps.example.com","context":"cluster-prod","replicas":2}}
```

Request `{ kind: "kubernetes", target: "production", image: "ghcr.io/org/app:sha" }`. The generated workload drops all capabilities, runs non-root, uses a read-only root filesystem and defines resource limits/readiness probes.

## Recommended production edge

Put Caddy, Traefik or Nginx in front of port 8787 for TLS. Keep `/v1/*` authenticated, and expose only `/sites/*`, `/preview/*` and `/apps/*` as needed. Replace the single shared `NAVEBOX_API_TOKEN` with your application's short-lived user tokens before offering a public multi-tenant service.
