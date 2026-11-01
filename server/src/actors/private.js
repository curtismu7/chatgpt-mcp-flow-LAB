// MOCK private MCP server on the internal network. It re-validates the on-behalf-of token itself (iss, aud, exp,
// scope, act) and enforces the per-API scope before running the tool. Fixed data, no outbound calls.
import { validateBearer } from '../tokens.js';
import { GATEWAY_NHI, ITEM, ORIGINS, SCOPE_TOOL, TOOL } from '../definition.js';
import { createActorApp, finishActorApp, recordChecks } from './base.js';

const PRICES = { [ITEM]: { price: 12.5, currency: 'USD' }, 'gadget-200': { price: 40, currency: 'USD' } };

export function bearerOf(req) {
  const m = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

export function toolResult(id, item) {
  const rec = Object.hasOwn(PRICES, item) ? PRICES[item] : null;
  if (!rec) return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `unknown item` }], isError: true } };
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `${item} costs ${rec.price.toFixed(2)} ${rec.currency}` }], structuredContent: { item, ...rec }, isError: false } };
}

export function createPrivateServer({ asJwks, clock, wire }) {
  const app = createActorApp();
  app.post('/mcp', (req, res) => {
    const token = bearerOf(req);
    const v = token ? validateBearer(token, { jwks: asJwks, iss: ORIGINS.as, aud: ORIGINS.private, nowSec: clock.nowSec(), scopes: [SCOPE_TOOL], actSub: GATEWAY_NHI })
      : { ok: false, error: 'invalid_token', reason: 'no bearer token', checks: [{ name: 'bearer token present', ok: false, detail: 'no bearer token' }] };
    recordChecks(wire, 'private', v.checks);
    if (!v.ok) {
      const status = v.error === 'insufficient_scope' ? 403 : 401;
      return res.status(status).set('WWW-Authenticate', `Bearer error="${v.error}", error_description="${v.reason.replace(/"/g, "'")}"`).json({ error: v.error, error_description: v.reason });
    }
    const b = req.body || {};
    if (b.method !== 'tools/call' || b.params?.name !== TOOL || typeof b.params?.arguments?.item !== 'string') {
      return res.json({ jsonrpc: '2.0', id: b.id ?? null, error: { code: -32601, message: 'only the price-lookup tool is served' } });
    }
    return res.json(toolResult(b.id ?? null, b.params.arguments.item.slice(0, 40)));
  });
  finishActorApp(app);
  return { app, reset() {} };
}
