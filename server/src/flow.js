// The 20-step orchestrator. It plays the user's browser and the AI assistant's MCP client over real HTTP against the
// mock actors, makes every decision the client would make (state, iss, PKCE, metadata checks), and returns each step's
// actual request and response. A mistake changes one thing the client or an actor does; the run then stops at the
// step where an actor refuses.
import { challengeS256, newVerifier } from './pkce.js';
import { parseJwt } from './jwt.js';
import { scopesOf } from './tokens.js';
import {
  CLIENT_ID, CONNECTOR_MANIFEST, CONNECTOR_STATES, ITEM, MEMBER_ID, MISTAKES, ORIGINS, REDIRECT_URI, SCOPE_OTHER, SCOPE_TOOL, STEPS, TOOL, TOKEN_TTL_SEC,
} from './definition.js';
import { MOCK_USER } from './actors/idp.js';

const MOCK_LABEL = 'MOCK-ISSUED (in-memory key, protects nothing)';
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const rand = (n = 16) => globalThis.crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');

function view(entry) {
  return { from: entry.from, to: entry.to, viaBrowser: entry.viaBrowser || undefined, request: entry.request, response: entry.response };
}
function tokenView(label, jwt) {
  const t = parseJwt(jwt);
  return { label: `${label} - ${MOCK_LABEL}`, jwt, header: t.ok ? t.header : null, claims: t.ok ? t.payload : null, scopes: t.ok ? scopesOf(t.payload) : [] };
}
const errorOf = (res) => {
  const b = res?.body;
  const fromHeader = /error="([^"]+)"/.exec(res?.headers?.['www-authenticate'] || '')?.[1];
  return { error: (b && typeof b === 'object' && typeof b.error === 'string' ? b.error : fromHeader) || `http_${res?.status}`, description: (b && typeof b === 'object' && b.error_description) || '' };
};

export async function runFlow({ wire, clock, pf, gateway, catalog, mistake = null }) {
  const m = mistake ? MISTAKES.find((x) => x.id === mistake) : null;
  if (mistake && !m) throw Object.assign(new Error('unknown mistake'), { code: 'unknown_mistake' });
  const steps = [];
  let refusal = null;
  const ctx = { tokens: {} };

  const meta = (n) => STEPS[n - 1];
  const ok = (n, extra = {}) => { steps.push({ ...meta(n), status: 'ok', exchanges: [], checks: [], ...extra }); };
  const refuse = (n, actor, error, description, extra = {}) => {
    refusal = { step: n, actor, error, description, standard: m?.standard ?? null };
    steps.push({ ...meta(n), status: 'refused', exchanges: [], checks: wire.since(mk).flatMap((e) => e.checks), ...extra, refusal });
    return null;
  };
  const checksOf = (entries, actor) => entries.filter((e) => e.to === actor).flatMap((e) => e.checks);
  const get = (url, from, to, extra = {}) => wire.call({ from, to, method: 'GET', url, ...extra });

  let mk = 0; // wire position at the start of the current step
  const clientState = rand(16);
  let verifier = newVerifier();
  const codeChallenge = challengeS256(verifier);
  const faults = { pf: pf.faults, gateway: gateway.faults, catalog: catalog.faults };
  catalog.reset(); // connector state belongs to one run

  try {
    if (m?.id === 'missing_iss') faults.pf.iss = 'omit';
    if (m?.id === 'forged_iss') faults.pf.iss = ORIGINS.attackerAs;
    if (m?.id === 'wrong_state') faults.pf.state = 'tamper';
    if (m?.id === 'passthrough') faults.gateway.passthrough = true;
    if (m?.id === 'unlisted_connector') faults.catalog.hold = true;

    // 1. the company publishes its connector (mock manifest, mock catalog on loopback)
    mk = wire.mark();
    const r1 = await wire.call({ from: 'publisher', to: 'catalog', method: 'POST', url: `${ORIGINS.catalog}/connectors`, json: CONNECTOR_MANIFEST });
    const connectorId = r1.body?.id;
    if (r1.status !== 202 || !connectorId) return finish(refuse(1, 'catalog', errorOf(r1).error, errorOf(r1).description, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'catalog') }));
    ok(1, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'catalog'), data: { connector_id: connectorId, state: r1.body.state } });

    // 2. the catalog reviews and lists it: an organisational step. The state flip is in-process; the exchange is a status read.
    catalog.review(connectorId);
    mk = wire.mark();
    const r2s = await get(`${ORIGINS.catalog}/connectors/${connectorId}`, 'publisher', 'catalog');
    ok(2, { exchanges: wire.since(mk).map(view), data: { connector_id: connectorId, state: r2s.body?.state, review: 'UNVERIFIED: what a real catalog review checks is not known here' }, note: 'Organisational step: no protocol is claimed. The mock lists the connector unless the "never listed" mistake holds the review.' });

    // 3. the member adds it from the catalog, free
    mk = wire.mark();
    const r3a = await wire.call({ from: 'user', to: 'catalog', method: 'POST', url: `${ORIGINS.catalog}/members/${MEMBER_ID}/connectors`, json: { connector_id: connectorId } });
    if (r3a.status !== 201) return finish(refuse(3, 'catalog', errorOf(r3a).error, errorOf(r3a).description, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'catalog') }));
    ok(3, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'catalog'), data: { cost_to_member: r3a.body.cost_to_member, install: r3a.body.install } });

    // 4. it appears in the member's own agent, not signed in yet
    mk = wire.mark();
    const r4a = await get(`${ORIGINS.catalog}/members/${MEMBER_ID}/connectors`, 'client', 'catalog');
    const record = r4a.body?.connectors?.find((c) => c.id === connectorId);
    if (r4a.status !== 200 || !record) return finish(refuse(4, 'client', 'connector_missing', 'the connector did not appear in the agent', { exchanges: wire.since(mk).map(view) }));
    ok(4, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'catalog'), data: { connector: record.name, state: record.state, mcp_server_url: record.mcp_server_url } });

    // 5. the user asks
    ok(5, { data: { user_says: `What does ${ITEM} cost?`, tool_needed: TOOL } });

    // 6. tool call with no token -> 401 + resource_metadata
    mk = wire.mark();
    const r2 = await wire.call({ from: 'client', to: 'gateway', method: 'POST', url: record.mcp_server_url, json: rpc(TOOL, { item: ITEM }) });
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(r2.headers['www-authenticate'] || '')?.[1];
    if (r2.status !== 401 || !metadataUrl) return finish(refuse(6, 'client', 'no_challenge', 'the gateway did not send a 401 with resource_metadata', { exchanges: wire.since(mk).map(view) }));
    catalog.setState(MEMBER_ID, connectorId, CONNECTOR_STATES.signin);
    ok(6, { exchanges: wire.since(mk).map(view), checks: wire.since(mk).flatMap((e) => e.checks), data: { resource_metadata: metadataUrl, connector_state: catalog.stateOf(MEMBER_ID, connectorId) } });

    // 7. protected-resource metadata; the resource must be the server we called (RFC 9728)
    mk = wire.mark();
    const r3 = await get(metadataUrl, 'client', 'gateway');
    const prm = r3.body;
    if (r3.status !== 200 || prm?.resource !== ORIGINS.gateway || !Array.isArray(prm?.authorization_servers) || prm.authorization_servers.length === 0) {
      return finish(refuse(7, 'client', 'resource_mismatch', 'the metadata does not describe the server that was called', { exchanges: wire.since(mk).map(view) }));
    }
    const asOrigin = prm.authorization_servers[0];
    ok(7, { exchanges: wire.since(mk).map(view), checks: [{ actor: 'client', name: 'resource equals the server URL', ok: true, detail: ORIGINS.gateway }], data: { authorization_server: asOrigin } });

    // 8. authorization-server metadata (RFC 8414): issuer must equal the URL it was fetched from; S256 must be offered
    mk = wire.mark();
    const r4 = await get(`${asOrigin}/.well-known/oauth-authorization-server`, 'client', 'pf');
    const meta4 = r4.body;
    if (r4.status !== 200 || meta4?.issuer !== asOrigin) return finish(refuse(8, 'client', 'issuer_mismatch', 'the metadata issuer is not the authorization server that was asked', { exchanges: wire.since(mk).map(view) }));
    if (!meta4.code_challenge_methods_supported?.includes('S256')) return finish(refuse(8, 'client', 'pkce_unsupported', 'the authorization server does not offer S256', { exchanges: wire.since(mk).map(view) }));
    ok(8, { exchanges: wire.since(mk).map(view), checks: [{ actor: 'client', name: 'issuer equals the metadata URL origin', ok: true, detail: meta4.issuer }, { actor: 'client', name: 'S256 offered', ok: true, detail: 'code_challenge_methods_supported includes S256' }], data: { iss_in_response: meta4.authorization_response_iss_parameter_supported === true } });

    // 9. authorization request
    const resource = m?.id === 'wrong_audience' ? ORIGINS.otherResource : ORIGINS.gateway;
    const scope = m?.id === 'wrong_scope' ? SCOPE_OTHER : SCOPE_TOOL;
    const redirectUri = m?.id === 'bad_redirect' ? `${REDIRECT_URI}/extra` : REDIRECT_URI;
    const q = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope, state: clientState, code_challenge: codeChallenge, code_challenge_method: 'S256' };
    if (m?.id !== 'missing_resource') q.resource = resource;
    mk = wire.mark();
    const authUrl = `${meta4.authorization_endpoint}?${new URLSearchParams(q)}`;
    const r5 = await get(authUrl, 'client', 'pf', { viaBrowser: true });
    const loc5 = r5.headers.location ? new URL(r5.headers.location) : null;
    const data5 = { code_verifier_held_by_client: 'kept private until step 14', code_challenge: codeChallenge };
    if (r5.status === 400) return finish(refuse(9, 'pf', errorOf(r5).error, errorOf(r5).description, { exchanges: wire.since(mk).map(view), data: data5 }));
    if (r5.status !== 302 || !loc5) return finish(refuse(9, 'pf', `http_${r5.status}`, 'unexpected response', { exchanges: wire.since(mk).map(view), data: data5 }));
    if (loc5.origin === ORIGINS.client) {
      const e = loc5.searchParams.get('error') || 'error';
      return finish(refuse(9, 'pf', e, loc5.searchParams.get('error_description') || '', { exchanges: wire.since(mk).map(view), data: data5 }));
    }
    ok(9, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'pf'), data: data5 });

    // 10. front-channel redirect: the browser follows the 302 to the enterprise IdP
    mk = wire.mark();
    const r6 = await get(loc5.toString(), 'client', 'idp', { viaBrowser: true });
    if (r6.status !== 200 || !r6.body?.txn) return finish(refuse(10, 'idp', errorOf(r6).error, errorOf(r6).description, { exchanges: wire.since(mk).map(view) }));
    ok(10, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'idp') });

    // 11. the user authenticates at the IdP (mock credentials; password and one-time code are redacted in the output)
    mk = wire.mark();
    const r7 = await wire.call({ from: 'user', to: 'idp', method: 'POST', url: `${ORIGINS.idp}/authenticate`, viaBrowser: true, json: { txn: r6.body.txn, username: MOCK_USER.username, password: MOCK_USER.password, otp: MOCK_USER.otp } });
    if (r7.status !== 302) return finish(refuse(11, 'idp', errorOf(r7).error, errorOf(r7).description, { exchanges: wire.since(mk).map(view) }));
    ok(11, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'idp') });
    const idTokenView = tokenView('ID token from the enterprise IdP', new URL(r7.headers.location).searchParams.get('id_token'));

    // 12. the ID token reaches PingFederate, which validates it and shows consent
    mk = wire.mark();
    const r8 = await get(r7.headers.location, 'idp', 'pf', { viaBrowser: true });
    if (r8.status !== 200 || !r8.body?.consent_id) return finish(refuse(12, 'pf', errorOf(r8).error, errorOf(r8).description, { exchanges: wire.since(mk).map(view), tokens: [idTokenView] }));
    ok(12, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'pf'), tokens: [idTokenView] });

    // 13. consent approved -> authorization code + state + iss to the redirect URI
    mk = wire.mark();
    const r9 = await wire.call({ from: 'user', to: 'pf', method: 'POST', url: `${ORIGINS.as}/as/consent`, viaBrowser: true, json: { consent_id: r8.body.consent_id, decision: 'approve' } });
    const loc9 = r9.headers.location ? new URL(r9.headers.location) : null;
    const ex9 = wire.since(mk).map(view);
    if (r9.status !== 302 || !loc9) return finish(refuse(13, 'pf', errorOf(r9).error, errorOf(r9).description, { exchanges: ex9 }));
    const cchecks = [];
    const cc = (name, good, detail) => { cchecks.push({ actor: 'client', name, ok: good, detail }); return good; };
    const sp = loc9.searchParams;
    if (!cc('redirect target is the registered redirect URI', `${loc9.origin}${loc9.pathname}` === REDIRECT_URI, `${loc9.origin}${loc9.pathname}`)) return finish(refuse(13, 'client', 'redirect_mismatch', 'the response went somewhere else', { exchanges: ex9, checks: cchecks }));
    if (!cc('state equals the state sent in step 9', sp.get('state') === clientState, 'compared with the value the client generated')) return finish(refuse(13, 'client', 'state_mismatch', 'state does not match the request', { exchanges: ex9, checks: cchecks }));
    const iss = sp.get('iss');
    if (!cc('iss is present (RFC 9207)', iss !== null || meta4.authorization_response_iss_parameter_supported !== true, iss === null ? 'the AS advertised iss support but sent none' : 'present')) return finish(refuse(13, 'client', 'iss_missing', 'the authorization response carries no iss', { exchanges: ex9, checks: cchecks }));
    if (!cc('iss equals the issuer from step 8', iss === null || iss === meta4.issuer, iss === null ? 'not sent' : iss)) return finish(refuse(13, 'client', 'iss_mismatch', 'iss is not the issuer this flow started with', { exchanges: ex9, checks: cchecks }));
    const code = sp.get('code');
    if (!code) return finish(refuse(13, 'pf', sp.get('error') || 'no_code', sp.get('error_description') || '', { exchanges: ex9, checks: cchecks }));
    ok(13, { exchanges: ex9, checks: [...checksOf(wire.since(mk), 'pf'), ...cchecks], data: { code, state: sp.get('state'), iss } });

    // 14. code redemption with the plaintext verifier
    if (m?.id === 'wrong_verifier') verifier = newVerifier();
    const tokenForm = () => ({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier, resource });
    mk = wire.mark();
    const r10 = await wire.call({ from: 'client', to: 'pf', method: 'POST', url: meta4.token_endpoint, form: tokenForm() });
    if (r10.status !== 200) return finish(refuse(14, 'pf', errorOf(r10).error, errorOf(r10).description, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'pf') }));
    if (m?.id === 'replayed_code') {
      const r10b = await wire.call({ from: 'client', to: 'pf', method: 'POST', url: meta4.token_endpoint, form: tokenForm() });
      return finish(refuse(14, 'pf', errorOf(r10b).error, `${errorOf(r10b).description} (second redemption of the same code)`, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'pf') }));
    }
    ok(14, { exchanges: wire.since(mk).map(view), checks: checksOf(wire.since(mk), 'pf') });

    // 15. the access token
    const accessToken = r10.body.access_token;
    ctx.tokens.access = tokenView('Access token', accessToken);
    catalog.setState(MEMBER_ID, connectorId, CONNECTOR_STATES.connected);
    ok(15, { tokens: [ctx.tokens.access], data: { expires_in: r10.body.expires_in, audience: ctx.tokens.access.claims?.aud, connector_state: catalog.stateOf(MEMBER_ID, connectorId) } });

    // 16-19. the MCP call: the gateway validates, exchanges and routes. The wire holds all three hops.
    if (m?.id === 'expired_token') clock.advance((TOKEN_TTL_SEC + 120) * 1000);
    mk = wire.mark();
    const r12 = await wire.call({ from: 'client', to: 'gateway', method: 'POST', url: `${ORIGINS.gateway}/mcp`, headers: { authorization: `Bearer ${accessToken}` }, json: rpc(TOOL, { item: ITEM }) });
    const hops = wire.since(mk);
    const [e0, e1, e2] = [hops[0], hops.find((h) => h.to === 'pf'), hops.find((h) => h.to === 'private')];
    if (r12.status === 401 || r12.status === 403) {
      return finish(refuse(16, 'gateway', errorOf(r12).error, errorOf(r12).description, { exchanges: [view(e0)], checks: e0.checks, tokens: [ctx.tokens.access] }));
    }
    ok(16, { exchanges: [view(e0)], checks: e0.checks, tokens: [ctx.tokens.access] });

    if (e1) {
      const obo = e1.response?.body?.access_token;
      const oboView = obo ? [tokenView('On-behalf-of token (RFC 8693)', obo)] : [];
      if (e1.response.status !== 200) return finish(refuse(17, 'pf', errorOf(e1.response).error, errorOf(e1.response).description, { exchanges: [view(e1)], checks: e1.checks }));
      ctx.tokens.obo = oboView[0];
      ok(17, { exchanges: [view(e1)], checks: e1.checks, tokens: oboView });
    } else {
      steps.push({ ...meta(17), status: 'skipped', exchanges: [], checks: e0.checks.filter((c) => c.name === 'token exchange'), note: 'The gateway skipped the exchange and forwarded the user token (the mistake you chose).' });
    }

    if (!e2 || e2.response.status !== 200) {
      const r = e2?.response;
      return finish(refuse(18, 'private', r ? errorOf(r).error : 'no_route', r ? errorOf(r).description : 'the gateway did not reach the private server', { exchanges: e2 ? [view(e2)] : [], checks: e2?.checks ?? [] }));
    }
    ok(18, { exchanges: [view(e2)], checks: e2.checks });

    const result = r12.body?.result;
    ok(19, { data: { result }, note: 'The tool result is the response body of the step 16 and 18 exchanges.' });
    ok(20, { data: { assistant_says: result?.content?.[0]?.text ?? 'no answer', structured: result?.structuredContent } });
    return finish(null);
  } finally {
    for (const k of Object.keys(faults.pf)) delete faults.pf[k];
    for (const k of Object.keys(faults.gateway)) delete faults.gateway[k];
    for (const k of Object.keys(faults.catalog)) delete faults.catalog[k];
    clock.reset();
  }

  function finish() {
    const held = m ? Boolean(refusal) && refusal.step === m.expected.step && refusal.actor === m.expected.actor && refusal.error === m.expected.error : null;
    return {
      mistake: m ? { id: m.id, label: m.label, why: m.why, standard: m.standard, expected: m.expected } : null,
      status: refusal ? 'refused' : 'completed',
      refusal,
      interlockHeld: held,
      stepsPlanned: STEPS.length,
      steps,
    };
  }
}
