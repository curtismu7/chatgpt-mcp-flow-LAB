// customer.config.json (repo root): the branding and vocabulary of one deployment, and the workspace id.
// The workspace id (default "default") scopes this process's in-memory state, its run ids and its trace sink: it is
// sent on every hop as `tracestate: mcpflow=<id>`, so two workspaces never share a trace. Nothing is read from disk but
// this one file, and nothing in it is a secret.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERTICALS } from './definition.js';

export const CONFIG_FILE = fileURLToPath(new URL('../../customer.config.json', import.meta.url));
export const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULTS = { brand: 'Example Corp', vertical: 'default', workspace: 'default' };

export function loadConfig({ env = process.env, file = CONFIG_FILE } = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('customer.config.json is not valid JSON'); }
  const cfg = { ...DEFAULTS, ...raw };
  if (env.MCP_FLOW_WORKSPACE) cfg.workspace = env.MCP_FLOW_WORKSPACE;
  if (typeof cfg.brand !== 'string' || !cfg.brand || cfg.brand.length > 60) throw new Error('config: brand must be a short string');
  if (!VERTICALS.includes(cfg.vertical)) throw new Error(`config: vertical must be one of ${VERTICALS.join(', ')}`);
  if (typeof cfg.workspace !== 'string' || !WORKSPACE_RE.test(cfg.workspace)) throw new Error('config: workspace must match [a-z0-9-], 1-32 characters');
  return { brand: cfg.brand, vertical: cfg.vertical, workspace: cfg.workspace };
}
