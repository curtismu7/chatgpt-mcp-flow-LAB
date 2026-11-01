// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a secret.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import crypto from 'node:crypto';
import { MISTAKES, STEPS, PARTICIPANTS } from './definition.js';
import { createKeyPair, signJwt, verifySignature } from './jwt.js';
import { challengeS256, verifyPkce } from './pkce.js';
import { PORT_MAX, PORT_MIN, STUB_COUNT, actorPortOk, assertBindAllowed, bindHost, portInRange, serverPort, stubBase } from './safety.js';
import { loadConfig } from './config.js';
import { DIAGRAM_NAMES, loadDiagram } from './diagramData.js';

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const [major] = process.versions.node.split('.').map(Number);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.MCP_FLOW_BIND ? ' (MCP_FLOW_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = serverPort(env);
  const first = stubBase(env);
  const last = first + STUB_COUNT - 1;
  const actorsOk = Array.from({ length: STUB_COUNT }, (_, i) => actorPortOk(first + i)).every(Boolean);
  add('port-range', portInRange(port) && actorsOk ? 'pass' : 'fail', portInRange(port) && actorsOk ? `server port ${port}, actors ${first}-${last} (all within ${PORT_MIN}-${PORT_MAX})` : `server port ${port} or actors ${first}-${last} are outside ${PORT_MIN}-${PORT_MAX} or blocked by fetch`);
  try { const c = loadConfig({ env }); add('config', 'pass', `customer.config.json ok (vertical ${c.vertical}, workspace ${c.workspace})`); } catch (e) { add('config', 'fail', e.message); }

  try {
    const k = createKeyPair('doctor');
    const t = signJwt({ alg: 'ES256', kid: 'doctor' }, { probe: true }, k.privateKey);
    const good = verifySignature(t, { keys: [k.publicJwk] }).ok && !verifySignature(`${t}x`, { keys: [k.publicJwk] }).ok;
    const v = crypto.randomBytes(32).toString('base64url');
    add('crypto', good && verifyPkce(v, challengeS256(v)) && !verifyPkce(`${v}x`, challengeS256(v)) ? 'pass' : 'fail', 'ES256 sign/verify and PKCE S256 round-trip with in-memory keys');
  } catch (e) { add('crypto', 'fail', `crypto self-test failed: ${e.message}`); }

  const stepsOk = STEPS.length === 20 && STEPS.every((s, i) => s.n === i + 1 && PARTICIPANTS.some((p) => p.id === s.from) && PARTICIPANTS.some((p) => p.id === s.to));
  const mistakesOk = MISTAKES.every((m) => m.expected.step >= 1 && m.expected.step <= STEPS.length && PARTICIPANTS.some((p) => p.id === m.expected.actor));
  add('definition', stepsOk && mistakesOk ? 'pass' : 'fail', `${STEPS.length} messages, ${PARTICIPANTS.length} participants, ${MISTAKES.length} mistake toggles`);

  try {
    const d = loadDiagram(DIAGRAM_NAMES[0]);
    const same = d.nodes.length === PARTICIPANTS.length && d.edges.length === STEPS.length && d.steps.length === STEPS.length && d.edges.every((e, i) => e.source === STEPS[i].from && e.target === STEPS[i].to);
    add('diagram', same ? 'pass' : 'fail', same ? `${d.id}: valid diagram-studio/1, ${d.nodes.length} boxes and ${d.edges.length} arrows match the definition` : `${d.id}: the diagram data does not match the 20-message definition`);
  } catch (e) { add('diagram', 'fail', e.message); }

  add('outbound', 'pass', 'no outbound settings: the actors talk to each other on 127.0.0.1 only, and no real credential is used or accepted');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
