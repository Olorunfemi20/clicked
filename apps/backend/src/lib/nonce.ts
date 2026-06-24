import { randomBytes } from 'crypto';

const TTL_MS = 5 * 60 * 1000;

const store = new Map<string, { nonce: string; expiresAt: number }>();

export function createNonce(walletAddress: string): string {
  const nonce = randomBytes(16).toString('hex');
  store.set(walletAddress, { nonce, expiresAt: Date.now() + TTL_MS });
  return nonce;
}

export function consumeNonce(walletAddress: string, nonce: string): boolean {
  const entry = store.get(walletAddress);
  if (!entry) return false;
  store.delete(walletAddress);
  if (Date.now() > entry.expiresAt) return false;
  return entry.nonce === nonce;
}
