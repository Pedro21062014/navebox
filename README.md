# Navebox

**Dois runtimes no navegador, um sistema de deploy opcional.** Navebox é uma IDE e SDK independente — não usa `@webcontainer/api` — com editor, filesystem virtual, terminal, npm, servidores HTTP, APIs, React, Vite, Next App Router e preview.

```bash
npm install @pedrobef/navebox
```

> Versão `0.2.0`. O modo Preview é pequeno e próprio. O modo Node usa um kernel de compatibilidade mantido no repositório (derivado sob MIT do projeto almostnode). Para Node 22 compilado em WebAssembly, existe um provider opcional BrowserPod que requer a chave/licença do próprio usuário.

## Dois modos

| Modo | Quando usar | O que executa |
|---|---|---|
| **Preview** | React/Vite/Preact/HTML, feedback instantâneo | esbuild-wasm + import maps + iframe sem mesma origem |
| **Node** | npm, Express, `http`, `fs`, Next API Routes e terminal | kernel Node lazy-loaded + VFS + Service Worker HTTP |

O bundle inicial continua leve: a UI e o modo Preview têm aproximadamente **26 kB gzip de JavaScript**. O kernel Node fica em chunks separados e só é baixado quando o usuário seleciona **Node**.

## Uso

### Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { naveboxPlugin } from '@pedrobef/navebox/vite';

export default defineConfig({
  plugins: [react(), naveboxPlugin()],
});
```

```tsx
import { Navebox } from '@pedrobef/navebox';
import '@pedrobef/navebox/style.css';

export default function Playground() {
  return (
    <Navebox
      initialTemplate="react"
      defaultMode="preview"
      height={760}
      autoRun
      nodeOptions={{
        // Somente para projetos confiáveis. Veja Segurança.
        allowTrustedSameOrigin: true,
        serviceWorkerUrl: '/navebox-sw.js',
      }}
    />
  );
}
```

O plugin serve `navebox-sw.js`, copia o arquivo no build e adiciona COOP/COEP para WebAssembly threads.

## APIs dentro do navegador

Selecione o template **Node API** e o modo **Node**. O projeto executa de verdade:

```js
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

http.createServer((req, res) => {
  if (req.url === '/api/health') {
    return res.end(JSON.stringify({
      ok: true,
      id: crypto.randomUUID(),
      file: fs.readFileSync('/project/data/message.txt', 'utf8'),
    }));
  }
  res.end('<h1>Navebox</h1>');
}).listen(3000);
```

O Service Worker converte a porta em `/__virtual__/3000/`. Navegação, `fetch`, assets e respostas JSON passam pelo servidor virtual.

### Express

O template **Express API** executa um `npm install` real no VFS, instala 68 pacotes e inicia Express 5:

```js
const express = require('express');
const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(3000);
```

Esse fluxo é coberto por um teste Chromium end-to-end, não por mock.

### Next

O adapter Node suporta:

- `app/page.tsx` e `app/layout.tsx`;
- Pages Router;
- rotas dinâmicas;
- `app/api/**/route.ts` e `pages/api/*`;
- métodos `GET`, `POST` e respostas streaming;
- CSS, TypeScript/TSX, import maps e HMR;
- `process.env` configurado.

O teste E2E chama uma rota real:

```ts
// app/api/health/route.ts
export async function GET() {
  return Response.json({ ok: true, runtime: 'next-api-browser' });
}
```

Turbopack/SWC nativos, addons `.node`, `child_process` nativo e sockets TCP arbitrários não podem ser reproduzidos pelo navegador. O adapter usa bindings Web/WASM em vez deles.

## Provider Node 22/WebAssembly

Para workloads que exigem um build completo de Node, configure o provider BrowserPod opcional:

```tsx
<Navebox
  defaultMode="node"
  nodeOptions={{
    provider: 'browserpod',
    browserPodApiKey: import.meta.env.VITE_BROWSERPOD_API_KEY,
    browserPodStorageKey: 'my-project',
  }}
/>
```

A aplicação deve cumprir a licença e limites do BrowserPod. A chave não é fornecida nem controlada pelo Navebox.

## API headless

```ts
import { bootBrowserNode } from '@pedrobef/navebox';

const node = await bootBrowserNode(files, {
  provider: 'compat',
  allowTrustedSameOrigin: true,
});

node.onTerminal(({ kind, text }) => console.log(kind, text));
node.onServer(({ url }) => iframe.src = url);

await node.run('npm', ['install']);
await node.start();
```

O modo Preview continua disponível pela classe `NaveboxRuntime`.

## Deploy e Supabase

Uma API que roda em uma aba desaparece quando a aba fecha. Para publicar um site persistente, use o **Navebox Runner** opcional:

```ts
import { NaveboxCloudClient } from '@pedrobef/navebox';

const cloud = new NaveboxCloudClient({
  endpoint: 'https://runner.example.com',
  token: () => getUserToken(),
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

### Destinos

| Tipo | Resultado |
|---|---|
| `static` | build real → Local/Supabase Storage → URL `/sites/:slug/` com SPA fallback |
| `container` | processo de produção isolado no Runner |
| `ssh-docker` | upload e container em VPS configurada |
| `kubernetes` | Deployment, Service e Ingress endurecidos |

Supabase Storage guarda os artefatos, mas não executa uma API Node. Por isso, sites estáticos podem ficar no Supabase; SSR e APIs persistentes usam um adapter de execução.

Documentação completa: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Runner local

```bash
cd runner
cp .env.example .env
# defina NAVEBOX_API_TOKEN

docker compose --env-file .env up -d --build
curl http://localhost:8787/health
```

Endpoints principais:

```text
POST   /v1/workspaces
PUT    /v1/workspaces/:id/files
POST   /v1/workspaces/:id/start
POST   /v1/workspaces/:id/commands
WS     /v1/workspaces/:id/logs
POST   /v1/deployments
GET    /sites/:slug/*
GET    /preview/:workspaceId/*
```

## Segurança

- Preview executa em iframe sem `allow-same-origin`.
- O kernel compatível usa JavaScript dinâmico e precisa de `allowTrustedSameOrigin: true`; use somente com código confiável.
- Para código público/não confiável, use o provider BrowserPod ou o Runner Docker.
- O Runner recusa `NAVEBOX_SANDBOX=process` em produção.
- Containers perdem capabilities, usam `no-new-privileges`, limites de CPU/RAM/PIDs e daemon separado.
- Caminhos, artefatos, variáveis e targets são validados contra traversal/injeção.
- Service-role do Supabase, SSH e kubeconfig ficam somente no Runner.
- Tokens de logs WebSocket são assinados, vinculados ao workspace e expiram em 60 segundos.

## Testes reais

```bash
npm run typecheck
npm test            # 47 testes unitários/integração
npm run test:e2e    # 5 testes Chromium
npm run build
```

Cobertura funcional validada:

- React no preview WebAssembly;
- CommonJS e módulos `fs`, `path`, `crypto`, `http`;
- API Node real no navegador;
- npm + Express 5 real;
- npm + React + Vite virtual;
- Next App Router + `route.ts` real;
- terminal POSIX;
- processo HTTP Node real no Runner e reverse proxy;
- build estático real, upload e SPA gateway;
- API Supabase Storage contra servidor HTTP de teste;
- adapters SSH-Docker e Kubernetes;
- autenticação, expiração, limites e path traversal.

## CI e publicação npm

O repositório inclui:

- `.github/workflows/ci.yml` — audit, tipos, 48 testes, build e 5 E2E;
- `.github/workflows/publish-npm.yml` — publica `@pedrobef/navebox` com provenance;
- `.github/workflows/runner-image.yml` — publica o Runner no GHCR com SBOM/provenance;
- Dependabot.

Crie no ambiente GitHub **npm** a secret:

```text
NPM_TOKEN=seu-token-de-automação-npm
```

Depois publique uma GitHub Release cujo tag corresponda ao `package.json`, por exemplo `v0.2.0`, ou execute manualmente o workflow **Publish npm**.

## Desenvolvimento

```bash
npm install
npm run dev
npm run dev:runner
npm run check
npm run test:e2e
npm run pack:local
```

Veja também [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

MIT © 2026 Pedro Bef and Navebox contributors
