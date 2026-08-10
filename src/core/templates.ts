import type { NaveboxTemplate } from './types';

const reactTemplate: NaveboxTemplate = {
  id: 'react',
  name: 'React',
  description: 'React 19 + TypeScript + CSS',
  framework: 'react',
  accent: '#7dd3fc',
  entryFile: '/src/App.tsx',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "react-navebox",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build"
  },
  "dependencies": {
    "react": "19.2.0",
    "react-dom": "19.2.0"
  },
  "devDependencies": {
    "vite": "7.3.1"
  }
}`,
    },
    {
      path: '/index.html',
      content: `<div id="root"></div>
<script type="module" src="./src/main.tsx"></script>`,
    },
    {
      path: '/src/main.tsx',
      content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
    },
    {
      path: '/src/App.tsx',
      content: `import { useState } from 'react';

const features = [
  ['⚡', 'Compilação instantânea', 'TypeScript e JSX compilados no navegador.'],
  ['⌘', 'Terminal integrado', 'Edite o projeto usando comandos familiares.'],
  ['◇', 'Preview isolado', 'Seu código roda em um iframe seguro e separado.'],
];

export default function App() {
  const [launches, setLaunches] = useState(0);

  return (
    <main className="page">
      <nav>
        <span className="brand"><i /> navebox</span>
        <span className="status">runtime online</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">BROWSER-NATIVE RUNTIME</p>
        <h1>Construa sem sair<br />do navegador.</h1>
        <p className="intro">
          Um ambiente React independente, rápido e totalmente client-side.
        </p>
        <button onClick={() => setLaunches((value) => value + 1)}>
          Executar experiência <span>→</span>
        </button>
        {launches > 0 && <p className="counter">Execuções locais: {launches}</p>}
      </section>

      <section className="grid">
        {features.map(([icon, title, body]) => (
          <article key={title}>
            <b>{icon}</b>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}`,
    },
    {
      path: '/src/styles.css',
      content: `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@500;700&display=swap');

* { box-sizing: border-box; }
:root { color: #eef2ff; background: #0a0d14; font-family: 'DM Sans', sans-serif; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 72% 12%, #19314c 0, transparent 28%), #0a0d14; }
button { font: inherit; }
.page { width: min(1040px, calc(100% - 48px)); margin: auto; padding-bottom: 64px; }
nav { height: 74px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #ffffff12; }
.brand { font: 700 17px 'Manrope', sans-serif; letter-spacing: -.03em; display: flex; align-items: center; gap: 9px; }
.brand i { width: 18px; height: 18px; display: inline-block; border: 5px solid #68d5ff; border-top-color: #a7f3d0; transform: rotate(45deg); border-radius: 4px; }
.status { color: #88a0b8; font: 500 11px monospace; text-transform: uppercase; letter-spacing: .08em; }
.status::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: #5ee6a8; box-shadow: 0 0 12px #5ee6a8; }
.hero { padding: 86px 0 66px; max-width: 760px; }
.eyebrow { color: #77d4ff; font: 600 11px monospace; letter-spacing: .18em; }
h1 { margin: 20px 0; font: 700 clamp(48px, 8vw, 78px)/.98 'Manrope', sans-serif; letter-spacing: -.065em; }
.intro { max-width: 520px; color: #99a9bc; font-size: 18px; line-height: 1.65; }
button { border: 0; color: #081018; background: #84dcff; border-radius: 10px; padding: 13px 18px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 34px #4ecbff2e; }
button span { margin-left: 12px; }
.counter { display: inline-block; margin-left: 16px; color: #83e6ba; font: 12px monospace; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
article { min-height: 176px; padding: 24px; border: 1px solid #ffffff12; border-radius: 14px; background: #ffffff08; backdrop-filter: blur(10px); }
article b { color: #7ed9ff; font-size: 21px; }
article h2 { margin: 24px 0 8px; font-size: 15px; }
article p { margin: 0; color: #8292a6; line-height: 1.55; font-size: 13px; }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } .hero { padding-top: 54px; } .counter { display: block; margin: 14px 0; } }`,
    },
  ],
};

const nextTemplate: NaveboxTemplate = {
  id: 'next',
  name: 'Next Lite',
  description: 'App Router client-side compatível',
  framework: 'next',
  accent: '#f8fafc',
  entryFile: '/app/page.tsx',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "next-navebox",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "16.0.0",
    "react": "19.2.0",
    "react-dom": "19.2.0"
  }
}`,
    },
    {
      path: '/index.html',
      content: `<div id="__next"></div>`,
    },
    {
      path: '/app/layout.tsx',
      content: `import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Navebox Next App',
  description: 'App Router executando direto no navegador',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}`,
    },
    {
      path: '/app/page.tsx',
      content: `'use client';

import { useState } from 'react';

const stats = [
  { label: 'Build time', value: '184ms', delta: '−22%' },
  { label: 'Modules', value: '12', delta: '+3' },
  { label: 'Runtime', value: 'Browser', delta: 'local' },
];

export default function Page() {
  const [deploys, setDeploys] = useState(3);

  return (
    <main>
      <header>
        <div className="logo"><span>N</span> northstar</div>
        <div className="header-actions"><i /> Local environment</div>
      </header>

      <section className="title-row">
        <div>
          <p className="kicker">OVERVIEW / AUGUST 2026</p>
          <h1>Good afternoon.</h1>
          <p>Your Next workspace is healthy and ready.</p>
        </div>
        <button onClick={() => setDeploys((count) => count + 1)}>New deployment</button>
      </section>

      <section className="stats">
        {stats.map((stat) => (
          <article key={stat.label}>
            <p>{stat.label}</p><strong>{stat.value}</strong><small>{stat.delta}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Recent deployments</h2><p>Compiled with the Navebox Next adapter</p></div><b>{deploys} total</b></div>
        {Array.from({ length: deploys }).slice(0, 5).map((_, index) => (
          <div className="deployment" key={index}>
            <span className="commit">↗</span>
            <div><strong>northstar-web-{deploys - index}</strong><p>app/page.tsx · local branch</p></div>
            <code>{index === 0 ? 'just now' : index + 'h ago'}</code>
            <em>Ready</em>
          </div>
        ))}
      </section>
    </main>
  );
}`,
    },
    {
      path: '/app/api/health/route.ts',
      content: `export async function GET() {
  return Response.json({
    ok: true,
    runtime: 'next-api-browser',
    timestamp: new Date().toISOString(),
  });
}`,
    },
    {
      path: '/app/globals.css',
      content: `* { box-sizing: border-box; }
:root { color: #171a21; background: #f3f3f0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; min-width: 320px; }
button { font: inherit; }
.app-shell { min-height: 100vh; }
main { width: min(1080px, calc(100% - 48px)); margin: auto; padding-bottom: 60px; }
header { height: 70px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #d9d9d4; }
.logo { font-weight: 750; letter-spacing: -.04em; }
.logo span { display: inline-grid; place-items: center; width: 25px; height: 25px; margin-right: 8px; color: white; background: #191b20; border-radius: 7px; }
.header-actions { color: #6a6d72; font-size: 12px; }
.header-actions i { display: inline-block; width: 7px; height: 7px; margin-right: 7px; background: #20b26b; border-radius: 50%; }
.title-row { display: flex; align-items: end; justify-content: space-between; padding: 64px 0 38px; }
.kicker { color: #888b8e !important; font: 600 10px monospace; letter-spacing: .12em; }
h1 { margin: 10px 0 8px; font-size: clamp(40px, 6vw, 62px); line-height: 1; letter-spacing: -.065em; }
.title-row p { color: #72757a; margin: 0; }
button { padding: 11px 16px; border: 0; border-radius: 8px; color: white; background: #1c1e23; cursor: pointer; font-size: 13px; font-weight: 650; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
.stats article { padding: 20px; border: 1px solid #dcdcd7; border-radius: 10px; background: #fafaf8; }
.stats p { margin: 0 0 17px; color: #777a7d; font-size: 12px; }
.stats strong { font-size: 26px; letter-spacing: -.05em; }
.stats small { float: right; margin-top: 9px; color: #358b62; font: 11px monospace; }
.panel { overflow: hidden; border: 1px solid #dcdcd7; border-radius: 12px; background: #fafaf8; }
.panel-head { display: flex; justify-content: space-between; align-items: center; padding: 22px; border-bottom: 1px solid #e2e2dd; }
.panel h2 { margin: 0 0 4px; font-size: 15px; }
.panel p { margin: 0; color: #85888c; font-size: 11px; }
.panel-head b { padding: 5px 9px; color: #64676b; background: #eeeeca; border-radius: 20px; font-size: 10px; }
.deployment { display: grid; grid-template-columns: 34px 1fr auto auto; gap: 12px; align-items: center; padding: 15px 22px; border-bottom: 1px solid #ededE8; }
.deployment:last-child { border: 0; }
.commit { display: grid; place-items: center; width: 30px; height: 30px; background: #ecece7; border-radius: 7px; }
.deployment strong { font-size: 12px; }
.deployment code { color: #8a8d90; font-size: 10px; }
.deployment em { color: #278558; background: #e2f4e9; border-radius: 20px; padding: 5px 9px; font: normal 10px monospace; }
@media (max-width: 650px) { .title-row { align-items: start; gap: 28px; flex-direction: column; } .stats { grid-template-columns: 1fr; } .deployment { grid-template-columns: 34px 1fr auto; } .deployment code { display: none; } }`,
    },
  ],
};

const preactTemplate: NaveboxTemplate = {
  id: 'preact',
  name: 'Preact',
  description: 'JSX mínimo para projetos leves',
  framework: 'preact',
  accent: '#b79cff',
  entryFile: '/src/App.tsx',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "preact-navebox",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "vite --host 0.0.0.0", "build": "vite build" },
  "dependencies": { "preact": "10.28.0" },
  "devDependencies": { "vite": "7.3.1" }
}`,
    },
    { path: '/index.html', content: `<div id="app"></div>\n<script type="module" src="./src/main.tsx"></script>` },
    {
      path: '/src/main.tsx',
      content: `import { render } from 'preact';
import App from './App';
import './style.css';

render(<App />, document.getElementById('app')!);`,
    },
    {
      path: '/src/App.tsx',
      content: `import { useState } from 'preact/hooks';

export default function App() {
  const [count, setCount] = useState(0);
  return <main><span>PREACT / NAVEBOX</span><h1>Pequeno por escolha.<br/>Rápido por natureza.</h1><p>JSX, hooks e módulos npm sem um servidor local.</p><button onClick={() => setCount(count + 1)}>Interações: {count}</button></main>;
}`,
    },
    {
      path: '/src/style.css',
      content: `*{box-sizing:border-box}body{margin:0;background:#161124;color:#f6f2ff;font-family:system-ui,sans-serif}main{min-height:100vh;padding:12vw;display:flex;align-items:flex-start;justify-content:center;flex-direction:column;background:radial-gradient(circle at 75% 30%,#5c3f8a66,transparent 30%)}span{color:#bca1ff;font:600 11px monospace;letter-spacing:.16em}h1{font-size:clamp(42px,8vw,84px);line-height:1;letter-spacing:-.07em;margin:20px 0}p{color:#afa6bd;font-size:18px}button{margin-top:18px;border:1px solid #ffffff26;background:#ffffff10;color:white;padding:12px 18px;border-radius:9px;cursor:pointer}`,
    },
  ],
};

const vanillaTemplate: NaveboxTemplate = {
  id: 'vanilla',
  name: 'Vanilla',
  description: 'HTML + CSS + TypeScript',
  framework: 'vanilla',
  accent: '#facc15',
  entryFile: '/src/main.ts',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "vanilla-navebox",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "vite --host 0.0.0.0", "build": "vite build" },
  "devDependencies": { "vite": "7.3.1" }
}`,
    },
    {
      path: '/index.html',
      content: `<main>
  <p class="label">NO FRAMEWORK / NO SERVER</p>
  <h1>Ideias em movimento.</h1>
  <p class="copy">TypeScript compilado inteiramente dentro do seu navegador.</p>
  <button id="action">Criar faísca <span>✦</span></button>
  <div id="sparks"></div>
</main>
<script type="module" src="./src/main.ts"></script>`,
    },
    {
      path: '/src/main.ts',
      content: `import './style.css';

const button = document.querySelector<HTMLButtonElement>('#action')!;
const sparks = document.querySelector<HTMLDivElement>('#sparks')!;
let count = 0;

button.addEventListener('click', () => {
  count += 1;
  const spark = document.createElement('i');
  spark.textContent = count % 2 ? '✦' : '·';
  spark.style.setProperty('--x', String(Math.random() * 80 + 10) + '%');
  sparks.append(spark);
  setTimeout(() => spark.remove(), 1200);
  console.log('Faísca criada:', count);
});`,
    },
    {
      path: '/src/style.css',
      content: `*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#f2ebdb;color:#26231e;font-family:Georgia,serif}main{position:relative;min-height:100vh;padding:12vh 10vw;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;background:linear-gradient(115deg,transparent 60%,#e7b74733)}.label{font:600 10px ui-monospace,monospace;letter-spacing:.2em}h1{max-width:800px;margin:18px 0;font-size:clamp(58px,11vw,120px);line-height:.84;letter-spacing:-.075em;font-weight:400}.copy{font:16px system-ui;color:#70695f}button{margin-top:24px;padding:13px 17px;border:1px solid #332f28;background:transparent;border-radius:99px;font:600 12px system-ui;cursor:pointer}button span{margin-left:12px}#sparks{position:absolute;inset:0;pointer-events:none}#sparks i{position:absolute;left:var(--x);bottom:15%;font-style:normal;font-size:42px;color:#d28b00;animation:rise 1.2s ease-out forwards}@keyframes rise{to{transform:translateY(-65vh) rotate(90deg);opacity:0}}`,
    },
  ],
};

const nodeApiTemplate: NaveboxTemplate = {
  id: 'node-api',
  name: 'Node API',
  description: 'HTTP, filesystem e API no navegador',
  framework: 'node',
  accent: '#68d391',
  entryFile: '/server.js',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "navebox-node-api",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "dev": "node server.js",
    "start": "node server.js"
  }
}`,
    },
    {
      path: '/data/message.txt',
      content: 'Este arquivo foi lido pela API usando node:fs dentro do navegador.\n',
    },
    {
      path: '/server.js',
      content: `const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

let requests = 0;

const server = http.createServer((req, res) => {
  requests += 1;
  res.setHeader('X-Powered-By', 'Navebox Node');

  if (req.url === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      runtime: 'node-browser',
      node: process.version,
      requestId: crypto.randomUUID(),
      requests,
      time: new Date().toISOString(),
    }));
    return;
  }

  if (req.url === '/api/file') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: fs.readFileSync('/project/data/message.txt', 'utf8').trim() }));
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end([
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09110e;color:#e8fff4;font-family:system-ui}main{width:min(700px,calc(100% - 40px))}.tag{color:#6ee7aa;font:11px monospace;letter-spacing:.14em}h1{font-size:clamp(42px,8vw,76px);line-height:.95;letter-spacing:-.065em;margin:20px 0}p{color:#91a99e;line-height:1.65}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:34px}.card{padding:18px;border:1px solid #214033;border-radius:12px;background:#0d1b15}code{color:#7ceeb5;font-size:11px}strong{display:block;margin-top:9px;font-size:14px}@media(max-width:550px){.grid{grid-template-columns:1fr}}</style>',
    '</head><body><main><span class="tag">NODE API · BROWSER RUNTIME</span>',
    '<h1>Uma API viva<br>dentro da aba.</h1>',
    '<p>Este HTML e os endpoints abaixo são servidos por <code>http.createServer()</code>. Edite <code>server.js</code> e reinicie para testar.</p>',
    '<div class="grid"><div class="card"><code>GET ./api/health</code><strong id="health">carregando…</strong></div>',
    '<div class="card"><code>GET ./api/file</code><strong id="file">carregando…</strong></div></div>',
    '<script>fetch("./api/health").then(r=>r.json()).then(v=>health.textContent=v.node+" · "+v.requests+" request");fetch("./api/file").then(r=>r.json()).then(v=>file.textContent=v.message)</script>',
    '</main></body></html>'
  ].join(''));
});

server.listen(3000, () => {
  console.log('Node API pronta em http://localhost:3000');
});`,
    },
  ],
};

const expressTemplate: NaveboxTemplate = {
  id: 'express',
  name: 'Express API',
  description: 'Express 5 + npm + rotas HTTP',
  framework: 'node',
  accent: '#a7f3d0',
  entryFile: '/server.js',
  files: [
    {
      path: '/package.json',
      content: `{
  "name": "express-navebox",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": { "dev": "node server.js", "start": "node server.js" },
  "dependencies": { "express": "5.1.0" }
}`,
    },
    {
      path: '/server.js',
      content: `const express = require('express');
const app = express();

app.use(express.json());
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, framework: 'express', runtime: process.version });
});
app.get('/', (_req, res) => {
  res.type('html').send('<!doctype html><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07120d;color:#eafff4;font-family:system-ui}main{max-width:700px;padding:40px}.tag{color:#6ee7aa;font:12px monospace}h1{font-size:clamp(50px,9vw,90px);line-height:.9;letter-spacing:-.07em;margin:22px 0}p{color:#91aa9d;font-size:18px}</style><main><span class="tag">EXPRESS 5 · NPM · NODE BROWSER</span><h1>Backend,<br>sem backend.</h1><p>Esta página e <code>GET /api/health</code> são respostas de uma aplicação Express instalada pelo npm virtual.</p></main>');
});

app.listen(3000, () => console.log('Express pronto na porta 3000'));`,
    },
  ],
};

export const naveboxTemplates: NaveboxTemplate[] = [reactTemplate, nextTemplate, nodeApiTemplate, expressTemplate, preactTemplate, vanillaTemplate];

export function getTemplate(template: string | NaveboxTemplate = 'react'): NaveboxTemplate {
  if (typeof template !== 'string') return template;
  return naveboxTemplates.find((candidate) => candidate.id === template) ?? reactTemplate;
}
