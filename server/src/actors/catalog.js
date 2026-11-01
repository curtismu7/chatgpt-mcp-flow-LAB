// MOCK connector catalog: the assistant's catalog as this teaching model imagines it. A company publishes a connector
// manifest once, the catalog lists it after a review, and a member adds it for free from the catalog (UNVERIFIED). Every endpoint,
// field and state here is invented for teaching: no real assistant's catalog is claimed to work this way (UNVERIFIED).
// The review is NOT a protocol: the orchestrator flips the state in-process (`review`) to stand in for an
// organisational step. Fixed data in memory only, bounded, no outbound calls.
import { CONNECTOR_STATES, ORIGINS } from '../definition.js';
import { createActorApp, finishActorApp, recordChecks, setBounded } from './base.js';

const ID_RE = /^conn-\d{4}$/;
const MEMBER_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const bad = (res, status, error, description) => res.status(status).json({ error, error_description: description });
const short = (v, n) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

export function createCatalog({ wire }) {
  const app = createActorApp();
  const faults = {}; // { hold: true } set in-process by the orchestrator only: the review never finishes
  const connectors = new Map(); // id -> { id, manifest, state }
  const added = new Map(); // `${member}/${id}` -> { member, id, state }
  let seq = 0;

  const record = (c) => ({ id: c.id, name: c.manifest.name, publisher: c.manifest.publisher, state: c.state });
  const memberView = (a) => {
    const c = connectors.get(a.id);
    return { id: a.id, name: c.manifest.name, publisher: c.manifest.publisher, mcp_server_url: c.manifest.mcp_server_url, tools: c.manifest.tools, cost_to_member: 'none', install: 'none: the catalog hosts the entry, the member installs nothing', state: a.state };
  };

  // 1. the publisher submits a manifest
  app.post('/connectors', (req, res) => {
    const m = req.body && typeof req.body === 'object' ? req.body : {};
    const manifest = {
      name: short(m.name, 80), publisher: short(m.publisher, 80), description: short(m.description, 200),
      mcp_server_url: short(m.mcp_server_url, 200), tools: Array.isArray(m.tools) && m.tools.length <= 10 && m.tools.every((t) => short(t, 60)) ? m.tools : null,
      authorization: short(m.authorization, 200),
    };
    let url = null;
    try { url = new URL(manifest.mcp_server_url); } catch { /* checked below */ }
    const complete = manifest.name && manifest.publisher && manifest.tools && url?.protocol === 'https:';
    wire.check('catalog', 'manifest is complete (name, publisher, https MCP server URL, tools)', Boolean(complete), complete ? manifest.mcp_server_url : 'a required field is missing or invalid');
    if (!complete) return bad(res, 400, 'invalid_manifest', 'name, publisher, an https mcp_server_url and a tool list are required');
    const id = `conn-${String((seq += 1)).padStart(4, '0')}`;
    const c = { id, manifest, state: CONNECTOR_STATES.review };
    setBounded(connectors, id, c, 50);
    return res.status(202).json({ ...record(c), note: 'accepted for review; it is not listed yet' });
  });

  // 2. the publisher reads the status (a stand-in for whatever a real catalog tells its publisher)
  app.get('/connectors/:id', (req, res) => {
    const c = ID_RE.test(req.params.id) ? connectors.get(req.params.id) : null;
    if (!c) return bad(res, 404, 'connector_not_found', 'no such connector');
    return res.json({ ...record(c), listed: c.state !== CONNECTOR_STATES.review });
  });

  // 3. a member adds a listed connector, free
  app.post('/members/:member/connectors', (req, res) => {
    if (!MEMBER_RE.test(req.params.member)) return bad(res, 400, 'invalid_request', 'malformed member id');
    const id = short(req.body?.connector_id, 20);
    const c = id && ID_RE.test(id) ? connectors.get(id) : null;
    if (!c) { wire.check('catalog', 'connector exists', false, 'unknown connector id'); return bad(res, 404, 'connector_not_found', 'no such connector'); }
    const listed = c.state !== CONNECTOR_STATES.review;
    wire.check('catalog', 'connector is listed', listed, `state: ${c.state}`);
    if (!listed) return bad(res, 409, 'connector_not_listed', 'this connector is still in review and is not listed, so it cannot be added');
    const a = { member: req.params.member, id, state: CONNECTOR_STATES.added };
    setBounded(added, `${a.member}/${id}`, a, 50);
    return res.status(201).json(memberView(a));
  });

  // 4. the member's agent lists what the member has added
  app.get('/members/:member/connectors', (req, res) => {
    if (!MEMBER_RE.test(req.params.member)) return bad(res, 400, 'invalid_request', 'malformed member id');
    const mine = [...added.values()].filter((a) => a.member === req.params.member).map(memberView);
    recordChecks(wire, 'catalog', [{ name: 'only this member\'s connectors are returned', ok: true, detail: `${mine.length} connector(s)` }]);
    return res.json({ catalog: ORIGINS.catalog, connectors: mine });
  });

  finishActorApp(app);
  return {
    app, faults,
    // Organisational steps, not protocol: the review outcome and the later state changes the agent would show.
    review(id) { const c = connectors.get(id); if (c && !faults.hold) c.state = CONNECTOR_STATES.listed; return c?.state ?? null; },
    setState(member, id, state) { const a = added.get(`${member}/${id}`); if (a) a.state = state; return a?.state ?? null; },
    stateOf(member, id) { return added.get(`${member}/${id}`)?.state ?? null; },
    reset() { connectors.clear(); added.clear(); seq = 0; for (const k of Object.keys(faults)) delete faults[k]; },
  };
}
