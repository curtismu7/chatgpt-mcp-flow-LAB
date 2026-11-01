import { startHttpServer } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { installNetguard } from './netguard.js';
import { applySharedSettings } from './settings.js';

// Zero real outbound: the guard goes on before anything listens. The only sockets this process opens are loopback ones.
installNetguard();
// The one shared settings file (~/Development/.env, or STANDALONE_ENV). Only the keys in settings.js are taken from it, and a real
// environment variable wins. There is no per-app .env.
applySharedSettings();

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[chatgpt-mcp-flow] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const { url, runtime } = await startHttpServer();
console.log(`[chatgpt-mcp-flow] mock mode at ${url} (loopback unless MCP_FLOW_BIND is set)`);
console.log(`[chatgpt-mcp-flow] API: GET ${url}api/health | GET ${url}api/flow | POST ${url}api/runs | GET ${url}api/runs/:id | POST ${url}api/reset`);
console.log(`[chatgpt-mcp-flow] mock actors on 127.0.0.1:${Object.values(runtime.ports).join(', ')}`);
