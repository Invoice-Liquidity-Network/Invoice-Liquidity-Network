import { describe, it, expect } from 'vitest';
import { uploadToIpfs, getIpfsGatewayUrl, isValidIpfsCid } from './ipfs';

describe('ipfs utility', () => {
  it('generates a valid CID and gateway URL from text', async () => {
    const result = await uploadToIpfs('Dispute reason text', { fileName: 'reason.txt' });
    expect(result.cid).toContain('bafybeig');
    expect(result.uri).toBe(`ipfs://${result.cid}`);
    expect(result.gatewayUrl).toBe(`https://ipfs.io/ipfs/${result.cid}`);
    expect(result.name).toBe('reason.txt');
    expect(result.size).toBeGreaterThan(0);
    expect(isValidIpfsCid(result.cid)).toBe(true);
    expect(isValidIpfsCid(result.uri)).toBe(true);
  });

  it('converts ipfs:// uri to gateway url with custom gateway', () => {
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const url = getIpfsGatewayUrl(`ipfs://${cid}`, 'https://cloudflare-ipfs.com/ipfs');
    expect(url).toBe(`https://cloudflare-ipfs.com/ipfs/${cid}`);
  });

  it('validates invalid CIDs', () => {
    expect(isValidIpfsCid('')).toBe(false);
    expect(isValidIpfsCid('short')).toBe(false);
    expect(isValidIpfsCid('invalid chars space!')).toBe(false);
  });
});
