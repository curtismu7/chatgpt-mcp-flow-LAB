// The wire: every request between actors (and from the "browser" or MCP client) goes through here, over real HTTP on
// 127.0.0.1. Logical origins (https://auth.example ...) are mapped to the loopback port of the actor that plays them;
// any other origin is refused, so nothing can leave the machine. Each call is recorded with the request and response
// so a step can show what was actually sent. Actors add their validation results with check().
import crypto from 'node:crypto';
import { PORT_MAX, PORT_MIN } from './safety.js';

const KEEP_RESPONSE_HEADERS = ['location', 'www-authenticate', 'content-type', 'cache-control', 'retry-after'];
export const MAX_RESPONSE_BYTES = 64 * 1024;

export const WIRE_TIMEOUT_MS = 15_000;
const hex = (n) => crypto.randomBytes(n).toString('hex');

export function createWire({ routes, timeoutMs = WIRE_TIMEOUT_MS, fetchImpl = fetch, workspace = 'default' }) {
  // routes: Map<logical origin, loopback port>
  const entries = [];
  const stack = [];
  let seq = 0;
  let traceId = hex(16); // W3C trace context: one trace per run, a new span id on every hop

  function target(logicalUrl) {
    const u = new URL(logicalUrl);
    const port = routes.get(u.origin);
    if (port === undefined || port < PORT_MIN || port > PORT_MAX) throw Object.assign(new Error(`no actor answers for ${u.origin}`), { code: 'bad_target' });
    return { real: `http://127.0.0.1:${port}${u.pathname}${u.search}`, u };
  }

  async function call({ from, to, method = 'GET', url, headers = {}, form, json, record = true, viaBrowser = false }) {
    const { real } = target(url);
    const sent = { ...headers, traceparent: `00-${traceId}-${hex(8)}-01`, tracestate: `mcpflow=${workspace}` };
    // A ref'd timer, not AbortSignal.timeout: on Node 22 that timer is unref'd, so a call that never answers left the
    // event loop empty and the run was cancelled instead of timing out.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The wire call timed out.', 'TimeoutError')), timeoutMs);
    const init = { method, headers: { ...sent }, redirect: 'manual', signal: controller.signal };
    let body;
    if (form) { init.body = new URLSearchParams(form).toString(); init.headers['content-type'] = 'application/x-www-form-urlencoded'; body = { ...form }; }
    else if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; body = json; }
    const entry = { seq: (seq += 1), from, to, viaBrowser, request: { method, url, headers: { ...sent }, ...(body !== undefined ? { body } : {}) }, response: null, checks: [] };
    if (record) entries.push(entry);
    stack.push(entry);
    try {
      const res = await fetchImpl(real, init);
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_RESPONSE_BYTES).toString('utf8');
      let parsed = buf;
      try { parsed = buf ? JSON.parse(buf) : null; } catch { /* keep text */ }
      const hdrs = {};
      for (const h of KEEP_RESPONSE_HEADERS) { const v = res.headers.get(h); if (v !== null) hdrs[h] = v; }
      entry.response = { status: res.status, headers: hdrs, body: parsed };
      return entry.response;
    } finally { clearTimeout(timer); stack.pop(); }
  }

  return {
    call,
    entries,
    mark: () => entries.length,
    since: (m) => entries.slice(m),
    // Record a validation result against the innermost in-flight call that is addressed to `actor`.
    check(actor, name, ok, detail = '') {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].to === actor) { stack[i].checks.push({ actor, name, ok: Boolean(ok), detail: String(detail) }); return; }
      }
    },
    reset() { entries.length = 0; stack.length = 0; seq = 0; traceId = hex(16); },
  };
}
