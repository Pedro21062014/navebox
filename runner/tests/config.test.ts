import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  NODE_ENV: 'test',
  NAVEBOX_API_TOKEN: 'test-token-with-24-characters',
};

describe('runner config', () => {
  it('aplica defaults seguros', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ host: '0.0.0.0', port: 8787, sandbox: 'docker', storage: 'local' });
  });
  it('bloqueia process sandbox e token padrão em produção', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', NAVEBOX_SANDBOX: 'process', NAVEBOX_API_TOKEN: 'a'.repeat(24) })).toThrow('bloqueado');
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('segredo forte');
  });
  it('exige credenciais Supabase', () => {
    expect(() => loadConfig({ ...base, NAVEBOX_STORAGE: 'supabase' })).toThrow('SUPABASE_URL');
  });
  it('analisa targets JSON', () => {
    const config = loadConfig({ ...base, NAVEBOX_SSH_TARGETS: '{"prod":{"host":"example.com"}}' });
    expect(config.sshTargets).toHaveProperty('prod');
  });
});
