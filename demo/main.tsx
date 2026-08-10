import { createRoot } from 'react-dom/client';
import { Navebox } from '../src';
import './demo.css';

function Demo() {
  return (
    <div className="demo-page">
      <div className="demo-glow demo-glow-one" />
      <div className="demo-glow demo-glow-two" />
      <nav className="demo-nav">
        <a className="demo-logo" href="#top" aria-label="Navebox início">
          <svg viewBox="0 0 30 30" aria-hidden="true"><path d="M7 5.5h10.4L24 12v12.5H7z"/><path d="M17 5.5V12h7M11 17l2.5 2.5L19 14"/></svg>
          <span>navebox</span>
        </a>
        <div className="demo-nav-links">
          <a href="#runtime">Runtime</a>
          <a href="#architecture">Arquitetura</a>
          <a href="https://www.npmjs.com" target="_blank" rel="noreferrer">npm ↗</a>
        </div>
        <span className="demo-version">v0.2.1 opaque runtime</span>
      </nav>

      <header className="demo-hero" id="top">
        <div className="demo-eyebrow"><i /> OPEN SOURCE · BROWSER NATIVE</div>
        <h1>Seu ambiente de código.<br /><em>Sem servidor.</em></h1>
        <p>
          Preview WebAssembly instantâneo ou ambiente Node com npm, Express e APIs —
          dois runtimes independentes executando diretamente no navegador.
        </p>
        <div className="demo-install">
          <code><span>$</span> npm i @pedrobef/navebox</code>
          <button onClick={() => navigator.clipboard?.writeText('npm i @pedrobef/navebox')} aria-label="Copiar comando">Copiar</button>
        </div>
        <div className="demo-proof">
          <span><b>2</b> browser runtimes</span>
          <span><b>48+5</b> real tests</span>
          <span><b>100%</b> local preview</span>
        </div>
      </header>

      <main id="runtime" className="demo-runtime-wrap">
        <div className="demo-runtime-label">
          <span>LIVE PLAYGROUND</span>
          <p>Alterne entre Preview e Node; teste React, Express e rotas API do Next.</p>
          <i>● runtime local</i>
        </div>
        <Navebox
          initialTemplate="react"
          height={760}
          nodeOptions={{
            allowTrustedSameOrigin: true,
            serviceWorkerUrl: '/navebox-sw.js',
            kernelUrl: '/src/kernel/index.ts',
          }}
        />
      </main>

      <section className="demo-architecture" id="architecture">
        <div className="demo-section-copy">
          <span>COMO FUNCIONA</span>
          <h2>Peças pequenas.<br />Um ambiente completo.</h2>
          <p>O Preview permanece mínimo; o kernel Node, npm e a rede HTTP virtual são carregados somente quando o modo completo é selecionado.</p>
        </div>
        <div className="demo-steps">
          <article><small>01</small><b>Virtual FS</b><p>Arquivos em memória com persistência opcional e API observável.</p></article>
          <article><small>02</small><b>Dual runtime</b><p>Preview WASM leve ou Node com processos, npm e módulos CommonJS.</p></article>
          <article><small>03</small><b>Virtual HTTP</b><p>Service Worker transforma portas Node em previews e endpoints API.</p></article>
          <article><small>04</small><b>Deploy adapters</b><p>Supabase para artefatos; Docker, SSH e Kubernetes para APIs persistentes.</p></article>
        </div>
      </section>

      <footer>
        <div className="demo-logo"><svg viewBox="0 0 30 30"><path d="M7 5.5h10.4L24 12v12.5H7z"/><path d="M17 5.5V12h7M11 17l2.5 2.5L19 14"/></svg><span>navebox</span></div>
        <p>Runtime experimental independente. MIT License · 2026</p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
