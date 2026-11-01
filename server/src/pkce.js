// PKCE (RFC 7636), S256 only.
import crypto from 'node:crypto';

export const challengeS256 = (verifier) => crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
export const newVerifier = () => crypto.randomBytes(32).toString('base64url'); // 43 characters
export const isValidVerifier = (v) => typeof v === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(v);
export const isValidChallenge = (c) => typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);

// The PKCE interlock: the authorization server recomputes the challenge from the plaintext verifier and compares in constant time.
export function verifyPkce(verifier, challenge) {
  if (!isValidVerifier(verifier) || !isValidChallenge(challenge)) return false;
  const a = Buffer.from(challengeS256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
