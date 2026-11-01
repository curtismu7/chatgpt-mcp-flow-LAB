// MOCK public MCP gateway: the OAuth protected resource. 401 + WWW-Authenticate with resource_metadata (RFC 9728),
// validates iss, aud, exp and scope on every call, then performs the RFC 8693 exchange as its own non-human identity
// and routes to the private MCP server with the narrowed on-behalf-of token.
import { validateBearer } from '../tokens.js';
import { GATEWAY_NHI, ORIGINS, SCOPE_OTHER, SCOPE_TOOL, TOOL } from '../definition.js';
import { createActorApp, finishActorApp, recordChecks } from './base.js';
import { bearerOf } from './private.js';

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const METADATA_URL = `${ORIGINS.gateway}/.well-known/oauth-protected-resource`;

export function createGateway({ asJwks, clock, wire, gatewaySecret }) {
  const app = createActorApp();
  const faults = {}; // { passthrough: true } set in-process by the orchestrator only

  app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
    resource: ORIGINS.gateway,
    authorization_servers: [ORIGINS.as],
    scopes_supported: [SCOPE_TOOL, SCOPE_OTHER],
    bearer_methods_supported: ['header'],
  }));

  function challenge(res, status, error, description, extra = '') {
    const parts = [error ? `error="${error}"` : null, description ? `error_description="${description.replace(/"/g, "'")}"` : null, extra || null, `resource_metadata="${METADATA_URL}"`].filter(Boolean);
    return res.status(status).set('WWW-Authenticate', `Bearer ${parts.join(', ')}`).json(error ? { error, error_description: description } : { error: 'unauthorized', error_description: 'a bearer token is required' });
  }

  app.post('/mcp', async (req, res) => {
    const token = bearerOf(req);
    if (!token) { wire.check('gateway', 'bearer token present', false, 'no Authorization header'); return challenge(res, 401, null, null, `scope="${SCOPE_TOOL}"`); }
    const b = req.body || {};
    const v = validateBearer(token, { jwks: asJwks, iss: ORIGINS.as, aud: ORIGINS.gateway, nowSec: clock.nowSec(), scopes: [SCOPE_TOOL] });
    recordChecks(wire, 'gateway', v.checks);
    if (!v.ok) {
      return v.error === 'insufficient_scope'
        ? challenge(res, 403, 'insufficient_scope', v.reason, `scope="${SCOPE_TOOL}"`)
        : challenge(res, 401, 'invalid_token', v.reason);
    }
    if (b.method !== 'tools/call' || b.params?.name !== TOOL || typeof b.params?.arguments?.item !== 'string') {
      return res.json({ jsonrpc: '2.0', id: b.id ?? null, error: { code: -32601, message: 'only the price-lookup tool is served' } });
    }
    // The mistake `passthrough`: forward the user's token as it is, with no exchange.
    let downstream = token;
    if (!faults.passthrough) {
      const basic = Buffer.from(`${GATEWAY_NHI}:${gatewaySecret}`).toString('base64');
      const ex = await wire.call({
        from: 'gateway', to: 'pf', method: 'POST', url: `${ORIGINS.as}/as/token.oauth2`, headers: { authorization: `Basic ${basic}` },
        form: { grant_type: TOKEN_EXCHANGE, subject_token: token, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: ORIGINS.private, scope: SCOPE_TOOL },
      });
      if (ex.status !== 200) return res.status(502).json({ error: 'downstream_authorization_failed', pf_error: ex.body?.error ?? null });
      downstream = ex.body.access_token;
    } else {
      wire.check('gateway', 'token exchange', false, 'skipped: the user token is forwarded unchanged');
    }
    const down = await wire.call({ from: 'gateway', to: 'private', method: 'POST', url: `${ORIGINS.private}/mcp`, headers: { authorization: `Bearer ${downstream}` }, json: b });
    if (down.status !== 200) return res.status(502).json({ error: 'downstream_refused', downstream_status: down.status, downstream_error: down.body?.error ?? null });
    return res.json(down.body);
  });

  finishActorApp(app);
  return { app, faults, reset() { for (const k of Object.keys(faults)) delete faults[k]; } };
}
