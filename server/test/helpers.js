// Test helpers. Every test file owns a distinct slice of 6671-6699 so files running in parallel never collide.
import http from 'node:http';
import net from 'node:net';

// The wire's fetch refuses 6697, 6679 and 6665-6669, so no slice puts an actor there. guards uses 6698 for its control server.
export const BASES = { flow: 6680, actors: 6685, api: 6690, guards: 6671, static: 6699 };
const SLICE_END = { flow: 6684, actors: 6689, api: 6695, guards: 6678, static: 6699 };
export const GUARDS_CONTROL_PORT = 6698;

const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

// A run of `count` consecutive free loopback ports inside a file's own slice, so a foreign process holding one of
// them moves the test along instead of failing it. Ports always stay in 6671-6699.
const cursor = {};
export async function freeBase(slice, count = 5) {
  const first = BASES[slice]; const last = SLICE_END[slice];
  const starts = [];
  for (let s = cursor[slice] ?? first; s + count - 1 <= last; s += 1) starts.push(s);
  for (let s = first; s < (cursor[slice] ?? first) && s + count - 1 <= last; s += 1) starts.push(s);
  for (const start of starts) {
    let ok = true;
    for (let p = start; p < start + count && ok; p += 1) ok = await isFree(p);
    if (ok) { cursor[slice] = start + count; return start; }
  }
  throw new Error(`no ${count} free ports in ${first}-${last}`);
}

// Like fetch, but lets a test set the Host header. Resolves { status, headers, json, raw }.
export function request(port, method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(host ? { host } : {}), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
