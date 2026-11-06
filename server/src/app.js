// One Express app: the control API under /api. createApp() is what the tests use.
// Every displayed string in a run was made inert and redacted when the run was stored; responses are JSON only.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createHealth } from './health.js';
import { createRuntime } from './runtime.js';
import { MISTAKES, MISTAKE_IDS, PARTICIPANTS, PHASES, PROVENANCE, STANDARDS, STEPS } from './definition.js';
import { assertBindAllowed, bindHost, credentialGuard, hostGuard, originGuard, serverPort, stubBase } from './safety.js';
import { DEFAULT_DIAGRAM, DIAGRAM_NAMES, diagramByName } from './diagramData.js';
import { shelfInfo } from './shelfLink.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
// The built UI: same-origin scripts, styles, images and fetches only. (style-src allows inline styles: React Flow sets them.)
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const RUN_ID_RE = /^run-\d{4,9}$/;
// Mock | Live: this app has no live mode (no real provider is ever called), so Live is refused with this message.
export const LIVE_REFUSAL = 'Live mode is not available in this lab: every actor is an in-process mock on 127.0.0.1 and no real provider is configured or contacted, so the page stays in Mock mode.';
const methods = (allow) => (_req, res) => res.set('Allow', allow).status(405).json({ error: 'method_not_allowed' });

// Last-resort handler for errors outside the API router (guards, static files). Never leaks the message or stack.
export const outerErrorHandler = (err, _req, res, _next) => (err instanceof URIError || err.status === 400 ? bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' }));

export const FLOW_METADATA = Object.freeze({
  participants: PARTICIPANTS, phases: PHASES, steps: STEPS,
  mistakes: MISTAKES.map(({ id, label, expected, standard, why }) => ({ id, label, expected, standard, why })),
  standards: STANDARDS, provenance: PROVENANCE,
});

// webDist: the built UI (web/dist). null (the default, so API tests never depend on a build) disables static serving.
export function createApp({ runtime, health = createHealth(), webDist = null, config = loadConfig() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use(credentialGuard);
  app.use(originGuard);
  app.use((_req, res, next) => { res.set(API_HEADERS); next(); });
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, {
      index: 'index.html', dotfiles: 'ignore',
      setHeaders: (res) => res.set({ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }),
    }));
  }

  const api = express.Router();
  api.use('/health', health.router);
  api.use(express.json({ limit: '2kb' }));

  api.route('/flow').get((_req, res) => res.json({ mode: runtime.mode, config, ...FLOW_METADATA })).all(methods('GET'));

  api.route('/mode')
    .get((_req, res) => res.json({ mode: runtime.mode, source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, live: { supported: false, message: LIVE_REFUSAL } }))
    .post((req, res) => {
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'source')) return bad(res, 'the only accepted body field is { "source": "mock" | "real" }');
      if (body.source === 'mock') return res.json({ mode: runtime.mode, source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL });
      if (body.source === 'real') return res.status(409).json({ error: 'real_not_available', message: LIVE_REFUSAL, mode: runtime.mode, source: 'mock' });
      return bad(res, 'source must be "mock" or "real"');
    })
    .all(methods('GET, POST'));

  // Rule 19: what the Mock/Real toggle needs.
  api.route('/info').get((_req, res) => res.json({ source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL })).all(methods('GET'));

  // The diagram-studio/1 document the web app draws, loaded by name. A name is looked up, never used as a path.
  api.route('/diagram').get((req, res) => {
    const name = req.query.name === undefined ? DEFAULT_DIAGRAM : req.query.name;
    const doc = typeof name === 'string' ? diagramByName(name) : null;
    return doc ? res.json(doc) : bad(res, `name must be one of: ${DIAGRAM_NAMES.join(', ')}`, typeof name === 'string' ? 404 : 400);
  }).all(methods('GET'));

  api.route('/runs')
    .get((_req, res) => res.json({ mode: runtime.mode, runs: runtime.listRuns() }))
    .post(wrap(async (req, res) => {
      const body = req.body ?? {};
      // The only accepted field is "mistake" (one of the catalogue ids, or null). Targets, tokens and URLs are never accepted.
      if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'mistake')) return bad(res, 'the only accepted body field is { "mistake": "<id>" | null }');
      const mistake = body.mistake ?? null;
      if (mistake !== null && (typeof mistake !== 'string' || !MISTAKE_IDS.includes(mistake))) return bad(res, `mistake must be one of: ${MISTAKE_IDS.join(', ')}`);
      let run;
      try { run = await runtime.run(mistake); } catch (e) {
        if (e?.code === 'run_queue_full') return res.set('Retry-After', '2').status(429).json({ error: 'run_queue_full', message: 'a run is in progress and another is already queued; try again shortly' });
        throw e;
      }
      return res.json(run);
    }))
    .all(methods('GET, POST'));

  api.route('/runs/:id').get((req, res) => {
    if (!RUN_ID_RE.test(req.params.id)) return bad(res, 'malformed run id');
    const run = runtime.getRun(req.params.id);
    return run ? res.json(run) : bad(res, 'no such run', 404);
  }).all(methods('GET'));

  api.route('/reset').post(wrap(async (req, res) => {
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/reset takes no parameters');
    await runtime.reset(); // waits for a run in flight, so the run is never corrupted
    return res.json({ ok: true, mode: runtime.mode });
  })).all(methods('POST'));

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    if (err instanceof URIError || err.status === 400) return bad(res, 'malformed request');
    console.error('[chatgpt-mcp-flow] api error:', err.message);
    return res.status(500).json({ error: 'server_error' }); // never leaks the message or stack
  });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);
  app.use((_req, res) => bad(res, 'no such endpoint', 404));
  app.use(outerErrorHandler);
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless MCP_FLOW_BIND is set.
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime, webDist = DEFAULT_WEB_DIST, config = loadConfig({ env }) } = {}) {
  assertBindAllowed(host, env);
  const rt = runtime || await createRuntime({ stubBase: stubBase(env), workspace: config.workspace });
  const health = createHealth({ env });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime: rt, health, webDist, config }).listen(port, host);
    httpServer.once('error', async (e) => { health.stop(); await rt.close(); reject(e); });
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound, runtime: rt, url: `http://127.0.0.1:${bound}/`,
        close: async () => { health.stop(); await new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }); await rt.close(); },
      });
    });
  });
}
