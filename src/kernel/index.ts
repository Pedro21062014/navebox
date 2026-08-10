// Navebox browser Node compatibility kernel.
// Derived from the MIT-licensed almostnode project; see LICENSE.almostnode and THIRD_PARTY_NOTICES.md.

export { VirtualFS } from './virtual-fs';
export type { FSNode, Stats, FSWatcher, WatchListener, WatchEventType } from './virtual-fs';
export { Runtime } from './runtime';
export type { RuntimeOptions, Module, RequireFunction } from './runtime';
export { PackageManager } from './npm/index';
export { ServerBridge, getServerBridge, resetServerBridge } from './server-bridge';
export { ViteDevServer } from './frameworks/vite-dev-server';
export { NextDevServer } from './frameworks/next-dev-server';
export {
  exec,
  spawn,
  sendStdin,
  setStreamingCallbacks,
  clearStreamingCallbacks,
  initChildProcess,
} from './shims/child_process';
