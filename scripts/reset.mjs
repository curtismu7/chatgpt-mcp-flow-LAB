#!/usr/bin/env node
// Reset a running app: POST /api/reset clears the runs, the injected faults and every mock actor's state (queued behind a run in flight).
//   node scripts/reset.mjs [base-url]      (default http://127.0.0.1:${MCP_FLOW_PORT:-6650})
// Loopback only: refuses any other host. Needs the server already running. The diagram box positions live in the browser, so the page's
// own Reset button (or a reload) puts the boxes back; this script cannot reach them. Settings are not touched.
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/safety.js';

export async function reset(base = `http://127.0.0.1:${process.env.MCP_FLOW_PORT || 6650}`) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  const r = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin }, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv[2]).then((j) => console.log(`reset: ${j.ok ? 'ok' : 'failed'} (${j.mode} mode)`), (e) => { console.error(e.message); process.exit(1); });
}
