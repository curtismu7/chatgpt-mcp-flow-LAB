// Preflight: the same checks GET /api/health reports from, plus the netguard self-test, whether the ports are free, and one real run of the
// flow against the mock actors on loopback. Prints only pass/fail lines, never the value of a setting. Exit 1 on any failure. Needs no network.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard, netguardSelfTest } = await load('server/src/netguard.js');
installNetguard();
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings(); // the one shared ~/Development/.env (or STANDALONE_ENV); only this app's own key is taken

const { runChecks } = await load('server/src/doctor.js');
const { serverPort, stubBase, STUB_COUNT, PORT_MIN, PORT_MAX } = await load('server/src/safety.js');
let failed = 0;
const report = (level, name, detail) => {
  if (level === 'fail') failed++;
  console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`);
};

for (const c of runChecks()) report(c.level, c.id, c.detail);

const guard = await netguardSelfTest();
report(guard.ok ? 'pass' : 'fail', 'netguard', guard.ok ? `self-test: ${guard.blocked} routes out (fetch, socket, ip socket, dns, dns resolve, udp send, udp connect) are refused and recorded` : guard.detail);

const free = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => resolve(e.code));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(null)));
});
const port = serverPort();
const err = await free(port);
report(err ? 'fail' : 'pass', 'port', err ? `${port} is not free (${err}). Set MCP_FLOW_PORT to a free port in ${PORT_MIN}-${PORT_MAX}` : `${port} is free`);
const busy = [];
for (let p = stubBase(); p < stubBase() + STUB_COUNT; p++) if (await free(p)) busy.push(p);
const last = stubBase() + STUB_COUNT - 1;
report(busy.length ? 'fail' : 'pass', 'actor-ports', busy.length ? `in use: ${busy.join(', ')} (the mock actors need ${stubBase()}-${last}; set MCP_FLOW_STUB_BASE to move them)` : `${stubBase()}-${last} are free`);

// One real run: the five mock actors listen on loopback and walk all 20 messages, and a mistake is refused where the standard says.
if (!busy.length) {
  try {
    const { createRuntime } = await load('server/src/runtime.js');
    const rt = await createRuntime({ stubBase: stubBase() });
    try {
      const ok = await rt.run(null);
      const bad = await rt.run('wrong_verifier');
      const good = ok.status === 'completed' && ok.steps.length === 20 && bad.status === 'refused' && bad.interlockHeld === true;
      report(good ? 'pass' : 'fail', 'flow-run', good ? 'the happy path completed all 20 messages, and wrong_verifier was refused by PingFederate at message 14' : 'a real run against the mock actors did not behave as the definition says');
    } finally { await rt.close(); }
  } catch (e) { report('fail', 'flow-run', `the mock actors could not run: ${e.message}`); }
}

process.exit(failed ? 1 : 0);
