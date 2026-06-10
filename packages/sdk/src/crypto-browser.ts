/**
 * Web Crypto API wrapper — replaces Node.js crypto for browser environments.
 * Uses the global `crypto` object available in all modern browsers and
 * sandboxed iframes (including those with strict CSPs).
 */

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export async function generateKeyPair(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const key = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey('raw', key.publicKey),
    crypto.subtle.exportKey('pkcs8', key.privateKey),
  ]);
  return { publicKey: new Uint8Array(pub), privateKey: new Uint8Array(priv) };
}
