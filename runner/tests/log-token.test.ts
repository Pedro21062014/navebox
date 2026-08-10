import { describe, expect, it, vi } from 'vitest';
import { LogTokenService } from '../src/services/log-token.js';

it('gera tokens de log curtos, vinculados ao workspace e com expiração', () => {
  const service = new LogTokenService('a-very-long-test-secret-value');
  const token = service.create('workspace-a', 10);
  expect(service.verify(token, 'workspace-a')).toBe(true);
  expect(service.verify(token, 'workspace-b')).toBe(false);
  expect(service.verify(`${token}tampered`, 'workspace-a')).toBe(false);

  vi.useFakeTimers();
  const expiring = service.create('workspace-a', 1);
  vi.advanceTimersByTime(2_000);
  expect(service.verify(expiring, 'workspace-a')).toBe(false);
  vi.useRealTimers();
});
