import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class LogTokenService {
  constructor(private readonly secret: string) {}

  create(workspaceId: string, ttlSeconds = 60): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${workspaceId}.${expires}.${randomBytes(8).toString('hex')}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  verify(token: string | undefined, expectedWorkspaceId: string): boolean {
    if (!token) return false;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return false;
    try {
      const payload = Buffer.from(encoded, 'base64url').toString('utf8');
      const [workspaceId, expires] = payload.split('.');
      if (workspaceId !== expectedWorkspaceId || Number(expires) < Math.floor(Date.now() / 1000)) return false;
      const expected = this.sign(payload);
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      return left.length === right.length && timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
