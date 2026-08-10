import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

export async function tempDirectory(prefix = 'navebox-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function testConfig(dataDir: string, overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '8787',
    NAVEBOX_PUBLIC_ORIGIN: 'http://runner.test',
    NAVEBOX_API_TOKEN: 'test-token-with-24-characters',
    NAVEBOX_ALLOWED_ORIGINS: 'http://localhost:5173',
    NAVEBOX_SANDBOX: 'process',
    NAVEBOX_DATA_DIR: dataDir,
    NAVEBOX_LOCAL_ARTIFACTS: `${dataDir}/artifacts`,
    NAVEBOX_STORAGE: 'local',
    ...overrides,
  });
}

export const authHeaders = { authorization: 'Bearer test-token-with-24-characters' };
