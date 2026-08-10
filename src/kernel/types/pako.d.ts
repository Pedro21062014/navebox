declare module 'pako' {
  export function ungzip(data: Uint8Array): Uint8Array;
  export function gzip(data: Uint8Array | string): Uint8Array;
  export function deflate(data: Uint8Array | string): Uint8Array;
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflateRaw(data: Uint8Array | string): Uint8Array;
  export function inflateRaw(data: Uint8Array): Uint8Array;
  const pako: {
    ungzip: typeof ungzip;
    gzip: typeof gzip;
    deflate: typeof deflate;
    inflate: typeof inflate;
    deflateRaw: typeof deflateRaw;
    inflateRaw: typeof inflateRaw;
  };
  export default pako;
}
