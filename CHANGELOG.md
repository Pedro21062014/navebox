# Changelog

## 0.2.1 — 2026-08-10

- Added the missing `@pedrobef/navebox/vite` package export.
- Moved the Node compatibility kernel out of the consumer's module graph.
- Added opaque precompiled runtime assets under `lib/runtime/`.
- The Vite plugin now excludes Navebox from dependency optimization, serves runtime assets in development, and copies them during production builds.
- Added a clean-project Vite integration test constrained to a 256 MB Node heap.
- Added a regression assertion that fails if Vite rebundles kernel files into `dist/assets`.
- Serve and copy `esbuild.wasm` as an opaque runtime asset instead of fetching it from a CDN.
- Fixed a race where pressing Run while the Node kernel was still booting could fail intermittently.

## 0.2.0 — 2026-08-10

- Initial dual-runtime release.
- Browser Preview and Node modes.
- npm, Express, React/Vite and Next API support.
- Optional deployment Runner with Supabase, Docker, SSH and Kubernetes adapters.
