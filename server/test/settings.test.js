import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings, settingsPath } from '../src/settings.js';
import { loadConfig } from '../src/config.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this app\'s own key is taken from the shared settings file; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['MCP_FLOW_WORKSPACE']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nMCP_FLOW_WORKSPACE=team-a\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { MCP_FLOW_WORKSPACE: 'team-a' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'MCP_FLOW_WORKSPACE']);
    assert.equal(loadConfig({ env }).workspace, 'team-a', 'the workspace id reaches the config');
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('MCP_FLOW_WORKSPACE=from-file\n', (f) => assert.equal(applySharedSettings({ MCP_FLOW_WORKSPACE: 'from-env' }, f).MCP_FLOW_WORKSPACE, 'from-env'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('MCP_FLOW_WORKSPACE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});

test('the settings path is ~/Development/.env, or STANDALONE_ENV; there is no per-app .env loader', () => {
  assert.equal(settingsPath({ STANDALONE_ENV: '/somewhere/else.env' }), '/somewhere/else.env');
  assert.equal(settingsPath({}), path.join(os.homedir(), 'Development', '.env'));
  for (const f of ['../src/index.js', '../../scripts/doctor.mjs']) assert.ok(!/loadEnvFile/.test(fs.readFileSync(new URL(f, import.meta.url), 'utf8')), `${f} has no loadEnvFile`);
});
