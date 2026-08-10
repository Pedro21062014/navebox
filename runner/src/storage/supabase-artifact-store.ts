import type { ArtifactStore, StoredArtifact } from '../types.js';

export interface SupabaseArtifactStoreOptions {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  publicBucket?: boolean;
  fetch?: typeof globalThis.fetch;
}

export class SupabaseArtifactStore implements ArtifactStore {
  readonly kind = 'supabase' as const;
  private readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly bucket: string;
  private readonly publicBucket: boolean;
  private readonly request: typeof globalThis.fetch;

  constructor(options: SupabaseArtifactStoreOptions) {
    if (!options.url || !options.serviceRoleKey || !options.bucket) throw new Error('Configuração Supabase incompleta.');
    this.url = options.url.replace(/\/$/, '');
    this.serviceRoleKey = options.serviceRoleKey;
    this.bucket = options.bucket;
    this.publicBucket = options.publicBucket ?? true;
    this.request = options.fetch ?? globalThis.fetch;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<StoredArtifact> {
    const normalized = normalizeKey(key);
    const response = await this.request(`${this.url}/storage/v1/object/${encodeSegment(this.bucket)}/${encodeKey(normalized)}`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'content-type': contentType,
        'x-upsert': 'true',
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(data),
    });
    if (!response.ok) throw new Error(`Supabase upload ${response.status}: ${await response.text()}`);
    return {
      key: normalized,
      contentType,
      size: data.byteLength,
      etag: response.headers.get('etag') ?? undefined,
    };
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const normalized = normalizeKey(key);
    const visibility = this.publicBucket ? 'public' : 'authenticated';
    const response = await this.request(`${this.url}/storage/v1/object/${visibility}/${encodeSegment(this.bucket)}/${encodeKey(normalized)}`, {
      headers: this.authHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Supabase download ${response.status}: ${await response.text()}`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async deletePrefix(prefix: string): Promise<void> {
    const normalized = normalizeKey(prefix);
    const listResponse = await this.request(`${this.url}/storage/v1/object/list/${encodeSegment(this.bucket)}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: normalized, limit: 1_000, offset: 0 }),
    });
    if (!listResponse.ok) throw new Error(`Supabase list ${listResponse.status}: ${await listResponse.text()}`);
    const objects = await listResponse.json() as Array<{ name: string }>;
    if (!objects.length) return;
    const prefixes = objects.map((object) => `${normalized}/${object.name}`);
    const deleteResponse = await this.request(`${this.url}/storage/v1/object/${encodeSegment(this.bucket)}`, {
      method: 'DELETE',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes }),
    });
    if (!deleteResponse.ok) throw new Error(`Supabase delete ${deleteResponse.status}: ${await deleteResponse.text()}`);
  }

  publicUrl(key: string): string | null {
    if (!this.publicBucket) return null;
    return `${this.url}/storage/v1/object/public/${encodeSegment(this.bucket)}/${encodeKey(normalizeKey(key))}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
    };
  }
}

function normalizeKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`Chave Supabase inválida: ${key}`);
  }
  return normalized;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}
