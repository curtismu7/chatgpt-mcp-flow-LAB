// The standalone rulebook, pinned as tests: the files, the README standard, the CSS standard, Node 26, no k8s, no bare MODE, no per-app .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SKIP = new Set(['node_modules', 'dist', '.git', '.data', 'package-lock.json']);
const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.nvmrc', '.env.example', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/architecture.md', 'docs/content-pack.schema.json', 'docs/shelf-entry.json', 'customer.config.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/build-talk-track.mjs', 'server/diagrams/authorization-flow.json', 'server/src/netguard.js', 'server/src/settings.js', 'web/src/styles/standalone-ui.css', '.gitignore']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('package.json requires Node 26, has the standard scripts, and the Dockerfile uses a Node 26 base', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=26');
  for (const s of ['start', 'dev', 'build', 'test', 'doctor', 'reset', 'talk-track', 'content-pack']) assert.ok(pkg.scripts[s], s);
  assert.equal((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length, 2);
  assert.equal(read('.nvmrc').trim().replace(/^v/, '').split('.')[0], '26', '.nvmrc pins Node 26');
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the port text, the 12 sections in order; no internal names', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Demo$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/chatgpt-mcp-flow-LAB$/m);
  assert.match(r, /^Catalog: D25$/m);
  assert.match(r, /placeholder/);
  assert.match(r, /lsof -iTCP:6650 -sTCP:LISTEN -n -P/);
  assert.match(r, /MCP_FLOW_PORT=<other port> npm start/);
  assert.match(r, /Port range for this app: 6650-6699\./);
  assert.match(r, /Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090\./);
  assert.ok(!/ping-devops|cmuir|curtismu/i.test(r));
  const order = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker (optional)', 'Tests', 'Troubleshooting', 'Ownership'].map((h) => r.indexOf(`\n## ${h}`));
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  assert.match(r, /util\.parseEnv/);
  assert.match(r, /run by hand|Run these by hand/);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/);
  assert.match(ci, /gitleaks/);
  assert.match(ci, /MCP_FLOW_PORT=6659 npm run doctor/);
});

test('app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, no id selectors, breakpoints 600 and 900 only, no purple', () => {
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css));
  assert.ok(!/(^|[ ,>+~])#[A-Za-z]/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no id selector');
  assert.ok(!/outline:\s*none/.test(css), 'no outline: none');
  const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 0 && widths.every((w) => w === '600' || w === '900'), widths.join());
  assert.ok(!/purple|violet|magenta|indigo/i.test(css));
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') > 0 && main.indexOf('standalone-ui.css') < main.indexOf('app.css'), 'the shared stylesheet loads before the app stylesheet');
});

test('no colour literal anywhere in the web code, and no style attribute except diagram positions and sizes', () => {
  const files = walk(path.join(root, 'web/src')).filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) && !/fixtures/.test(f));
  for (const f of files) assert.ok(!/['"`]#[0-9a-fA-F]{3,8}['"`]|\brgba?\(|\bhsla?\(/.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} has a colour literal`);
  const styles = files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/style=\{\{([^}]*)\}\}/g)].map((m) => `${path.basename(f)}: ${m[1]}`));
  for (const s of styles) assert.match(s, /^Diagram\.jsx: /, `a style attribute outside the diagram: ${s}`);
});

test('the lab ships no k8s manifests (deferred by the owner, 2026-10-31), no bare MODE, no per-app .env loader, no EC generateKeyPair, and no credential field', () => {
  assert.ok(!fs.existsSync(path.join(root, 'k8s')));
  const code = walk(root).filter((f) => /\.(m?js|jsx)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('repo.test.mjs')).map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')]);
  for (const [f, t] of code) {
    assert.ok(!/process\.env\.MODE\b|\bMODE=mock\b/.test(t), `${f}: no bare MODE`);
    assert.ok(!/loadEnvFile/.test(t), `${f}: no per-app .env loader`);
    assert.ok(!/generateKeyPair(Sync)?\(\s*['"]ec['"]/.test(t), `${f}: no EC generateKeyPair`);
    assert.ok(!/type="password"/.test(t), `${f}: no password field`);
  }
});
