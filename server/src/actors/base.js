// Shared plumbing for the mock actors: a loopback-only Express listener with the Host guard and small bounded bodies.
import express from 'express';
import { hostGuard } from '../safety.js';

// The actors only ever hear from the orchestrator and from each other (Node fetch, no Origin, no Sec-Fetch-Site).
// A browser-originated cross-site request, or one carrying a cookie / API-key / proxy credential, is refused.
// (Authorization stays allowed: the mock bearer tokens and the gateway's Basic credentials travel in it.)
const ACTOR_REFUSED_HEADERS = ['cookie', 'proxy-authorization', 'x-api-key'];
export function actorGuard(req, res, next) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site' || req.headers.origin !== undefined) {
    return res.status(403).json({ error: 'cross_site_refused', error_description: 'this mock accepts server-to-server calls only' });
  }
  if (ACTOR_REFUSED_HEADERS.some((h) => req.headers[h] !== undefined)) return res.status(400).json({ error: 'credentials_not_accepted' });
  return next();
}

// Insert into a Map that never holds more than `max` entries: the oldest entry is dropped first.
export function setBounded(map, key, value, max = 200) {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

export function createActorApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use(actorGuard);
  app.use(express.json({ limit: '8kb' }));
  app.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 30 }));
  return app;
}

export function finishActorApp(app) {
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'entity.parse.failed' || err instanceof URIError || err.status === 400) return res.status(400).json({ error: 'invalid_request', error_description: 'malformed request' });
    return res.status(500).json({ error: 'server_error' });
  });
  return app;
}

export async function listenActor(app, port) {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1');
    s.once('error', reject);
    s.once('listening', () => resolve(s));
  });
  return { port, address: server.address().address, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// A query/body parameter must be a single string; repeated or nested parameters are treated as absent.
export const one = (v) => (typeof v === 'string' ? v : undefined);

export function recordChecks(wire, actor, checks) {
  for (const c of checks) wire.check(actor, c.name, c.ok, c.detail);
}
