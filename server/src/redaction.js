// Redaction. Mock-issued tokens, authorization codes and code verifiers are SHOWN on purpose (they are labelled
// MOCK-ISSUED and protect nothing). What is removed: anything that looks like a real secret, any value under a
// secret-looking key (passwords, one-time codes, client secrets, cookies), and Basic credentials.
const MARK = '[REDACTED]';
const SECRET_KEY = /(secret|passw(?:or)?d|api[-_]?key|cookie|credential|private[-_]?key|^otp$)/i;

export function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/-----BEGIN ([A-Z ]+)-----[\s\S]*?(?:-----END \1-----|$)/g, MARK)
    .replace(/\bBasic\s+[A-Za-z0-9+/=_-]{6,}/g, `Basic ${MARK}`)
    .replace(/\b(Set-Cookie|Cookie)(\s*:\s*)(?!\[REDACTED\])[^\s][^\r\n]*/gi, `$1$2${MARK}`)
    .replace(/\b(client_secret|password|passwd|api[-_]?key)(=)(?!\[REDACTED\])[^\s&,;]+/gi, `$1$2${MARK}`)
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MARK)
    .replace(/\b(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{16,}/g, MARK);
}

// Deep copy with secret-keyed values replaced and every string redacted. Iterative depth cap; never executes anything.
export function redactDeep(value, depth = 0) {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 14) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) && v !== null && v !== undefined && typeof v !== 'boolean' ? MARK : redactDeep(v, depth + 1);
  }
  return out;
}
