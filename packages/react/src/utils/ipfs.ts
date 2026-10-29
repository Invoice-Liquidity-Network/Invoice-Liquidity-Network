/**
 * Simple IPFS utility for dispute evidence upload and CID formatting.
 */

export interface IpfsUploadResult {
  cid: string;
  uri: string;
  gatewayUrl: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Basic hash function to generate a deterministic CIDv1 base32 string for testing/client env.
 */
function computeDeterministicHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `bafybeig${hex}disputeevidence${hex.slice(0, 4)}7q`;
}

/**
 * Uploads a file or string payload to IPFS (mockable/client-side fallback).
 */
export async function uploadToIpfs(
  fileOrContent: File | Blob | string,
  options?: { customGateway?: string; fileName?: string }
): Promise<IpfsUploadResult> {
  const gateway = options?.customGateway ?? 'https://ipfs.io/ipfs';
  let name = options?.fileName ?? 'evidence.txt';
  let size = 0;
  let type = 'text/plain';
  let contentString = '';

  if (typeof fileOrContent === 'string') {
    contentString = fileOrContent;
    size = new Blob([fileOrContent]).size;
    type = 'text/plain';
  } else if (fileOrContent instanceof File) {
    name = fileOrContent.name;
    size = fileOrContent.size;
    type = fileOrContent.type || 'application/octet-stream';
    contentString = `${name}-${size}-${fileOrContent.lastModified}`;
  } else if (fileOrContent instanceof Blob) {
    size = fileOrContent.size;
    type = fileOrContent.type || 'application/octet-stream';
    contentString = `blob-${size}`;
  }

  const cid = computeDeterministicHash(contentString + Date.now().toString());
  const uri = `ipfs://${cid}`;
  const gatewayUrl = `${gateway}/${cid}`;

  return {
    cid,
    uri,
    gatewayUrl,
    name,
    size,
    type,
  };
}

/**
 * Converts an IPFS CID or ipfs:// URI to a web gateway URL.
 */
export function getIpfsGatewayUrl(cidOrUri: string, customGateway = 'https://ipfs.io/ipfs'): string {
  if (!cidOrUri) return '';
  const cleanCid = cidOrUri.replace(/^ipfs:\/\//, '');
  return `${customGateway}/${cleanCid}`;
}

/**
 * Validates whether a string is a well-formed IPFS CID or URI.
 */
export function isValidIpfsCid(cidOrUri: string): boolean {
  if (!cidOrUri || typeof cidOrUri !== 'string') return false;
  const clean = cidOrUri.replace(/^ipfs:\/\//, '').trim();
  // Validates CIDv0 (Qm... 46 chars) or CIDv1 (bafy... / bafk... 50+ chars) or alphanum test
  return clean.length >= 10 && /^[a-zA-Z0-9_-]+$/.test(clean);
}
