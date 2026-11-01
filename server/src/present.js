// Everything shown to a viewer passes through here once, before it is stored: secret-looking values are redacted
// and every string is made inert (hidden and control characters shown as [U+XXXX]) and bounded.
// Mock tokens, codes and verifiers are NOT secret and stay visible; see redaction.js.
import { redactDeep } from './redaction.js';
import { inertValue } from './sanitize.js';

export const presentValue = (v) => inertValue(redactDeep(v));
