# Architecture

```text
Browser
├── Preview mode (small, default)
│   ├── VirtualFileSystem
│   ├── esbuild-wasm Worker
│   └── sandboxed srcdoc iframe
│
├── Node mode
│   ├── Navebox compatibility kernel (MIT-derived)
│   │   ├── CommonJS/ESM loader
│   │   ├── Node API shims + POSIX shell
│   │   ├── npm registry/tar extraction
│   │   ├── Vite + Next App/API adapters
│   │   └── Service Worker virtual HTTP network
│   └── optional BrowserPod provider (real Node 22/Wasm, user API key)
│
└── NaveboxCloudClient (optional)
    └── HTTPS / WebSocket
        └── Navebox Runner
            ├── Docker/Process sandbox
            ├── real npm install/build/start
            ├── Local or Supabase artifact store
            ├── static SPA gateway
            └── container / SSH-Docker / Kubernetes adapters
```

## Why two browser modes?

The fast preview path is around tens of kilobytes and covers client applications. The Node kernel is lazy-loaded only when selected; it provides filesystem, package manager, processes and virtual HTTP. Keeping these chunks separate prevents every visitor from paying the cost of a full development runtime.

The browser cannot expose raw listening sockets. The Service Worker maps `/__virtual__/:port/*` to an in-tab HTTP server. The API is real from the application's perspective, but it exists only while that browser session is alive. Persistent public SSR/API deployments therefore use the optional Runner.

## Security boundaries

- Preview mode executes user code only in an iframe without `allow-same-origin`.
- The compatibility Node kernel currently requires explicit `allowTrustedSameOrigin`; use it only for trusted code.
- For untrusted full Node, configure the BrowserPod provider or deploy a dedicated cross-origin kernel host.
- Runner production mode refuses host `process` execution and requires Docker.
- Project paths, artifact keys, environment names and deployment targets are validated.
- SSH/Kubernetes credentials remain in Runner environment variables.
- Supabase service-role credentials never enter browser bundles.
