// Customer neutrality: the repo (tree and history) must contain no forbidden identifier. The hidden list lives outside the repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CONNECTOR_MANIFEST, MISTAKES, ORIGINS, PARTICIPANTS, PHASES, STEPS } from '../server/src/definition.js';
import { BUILTIN, defaultListPath, readHiddenList, scanHistory, scanTree } from './lib/neutrality.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const j = (...p) => p.join('');

test('the built-in scanner catches assembled customer tokens and real hostnames, and passes neutral text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-neutral-'));
  try {
    const bad = [j('see ', 'U', 'H', 'G', ' docs'), j('the ', 'hs', 'id', ' idp'), j('United', 'Health', ' group'), j('scope ', 'rx', '.price', '.read'), j('Digital ', 'Front', ' Door'), 'fetch https://' + j('api.', 'vendor', '.com') + '/x'];
    bad.forEach((t, i) => fs.writeFileSync(path.join(dir, `bad${i}.txt`), t));
    fs.writeFileSync(path.join(dir, 'good.txt'), 'Example Corp, items.read, https://auth.example/x, https://a.invalid, http://127.0.0.1:6650/api, a front door, ordinary words like optimum and thug');
    const hits = scanTree(dir, null);
    const files = new Set(hits.map((h) => h.file));
    bad.forEach((_, i) => assert.ok(files.has(`bad${i}.txt`), `bad${i}.txt is detected`));
    assert.ok(!files.has('good.txt'), 'neutral text passes');
    assert.ok(BUILTIN.length >= 8);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('github.com is allowed only for this repo URL and the gitleaks release download, not for any other org', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-neutral-'));
  try {
    const ok = ['https://github.com/curtismu7/chatgpt-mcp-flow-LAB', 'git clone https://github.com/curtismu7/chatgpt-mcp-flow-LAB.git', 'base=https://github.com/gitleaks/gitleaks/releases/download/v8.18.4'];
    const gh = j('https', ':', '//git', 'hub.com');
    const bad = [gh + '/' + j('some', '-customer', '-org') + '/repo', gh + '/ping-sandbox/other-repo', gh + '/ping-sandbox/chatgpt-mcp-flow-LAB-evil', gh + '/gitleaks/gitleaks/issues/1', j('https', ':', '//Git', 'Hub.com') + '/' + j('acme', '-corp'), gh];
    ok.forEach((t, i) => fs.writeFileSync(path.join(dir, `ok${i}.txt`), t));
    bad.forEach((t, i) => fs.writeFileSync(path.join(dir, `bad${i}.txt`), t));
    const files = new Set(scanTree(dir, null).map((h) => h.file));
    ok.forEach((_, i) => assert.ok(!files.has(`ok${i}.txt`), `ok${i}.txt passes`));
    bad.forEach((_, i) => assert.ok(files.has(`bad${i}.txt`), `bad${i}.txt is detected`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the hidden-list scanner reports a file and an index, never the matched text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-neutral-'));
  try {
    const needle = j('zz', 'qq', '-needle-', '42');
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, `harmless-one\n${needle}\n`);
    fs.mkdirSync(path.join(dir, 'tree'));
    fs.writeFileSync(path.join(dir, 'tree', 'a.txt'), `x ${needle} y`);
    const hits = scanTree(path.join(dir, 'tree'), readHiddenList(list));
    assert.deepEqual(hits, [{ file: 'a.txt', rule: 'hidden-2' }]);
    assert.ok(!JSON.stringify(hits).includes(needle));
    assert.equal(readHiddenList(path.join(dir, 'absent.txt')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('this repo tree has no customer identifier, no real hostname (built-in checks)', () => {
  const hits = scanTree(root, null);
  assert.deepEqual(hits, [], `neutrality findings (file and rule only): ${JSON.stringify(hits)}`);
});

test('this repo history has no customer identifier (built-in checks)', (t) => {
  const hits = scanHistory(root, null);
  if (hits === null) return t.skip('no git history in this checkout (a tarball or an export): the history scan was skipped');
  assert.deepEqual(hits, [], `history findings (rule only): ${JSON.stringify(hits)}`);
});

test('the hidden forbidden-strings list finds nothing in the tree or the history', (t) => {
  const file = defaultListPath();
  const hidden = readHiddenList(file);
  if (!hidden) return t.skip(`forbidden-strings list not found at ${path.basename(path.dirname(file))}/${path.basename(file)} (set FORBIDDEN_STRINGS_FILE): the hidden-list check was skipped`);
  const tree = scanTree(root, hidden).filter((h) => h.rule.startsWith('hidden-'));
  assert.deepEqual(tree, [], `hidden-list findings in the tree (file and index only): ${JSON.stringify(tree)}`);
  const hist = scanHistory(root, hidden);
  if (hist) assert.deepEqual(hist.filter((h) => h.rule.startsWith('hidden-')), [], 'hidden-list findings in the history');
});

test('the catalog phase names no real assistant, store or company, and every catalog host is .example', () => {
  const text = JSON.stringify([STEPS.filter((x) => x.phase === 'catalog'), PARTICIPANTS.filter((x) => ['publisher', 'catalog'].includes(x.id)), PHASES.find((x) => x.id === 'catalog'), MISTAKES.find((x) => x.id === 'unlisted_connector'), CONNECTOR_MANIFEST]);
  for (const word of [j('Chat', 'GPT'), j('GPT', ' Store'), j('App', ' Store'), j('Play', ' Store'), j('Open', 'AI'), j('Anthro', 'pic'), j('Micro', 'soft'), j('Goo', 'gle')]) {
    assert.ok(!text.toLowerCase().includes(word.toLowerCase()), 'a real product or company name appears in the catalog phase');
  }
  assert.ok(new URL(ORIGINS.catalog).hostname.endsWith('.example'));
  assert.ok(new URL(CONNECTOR_MANIFEST.mcp_server_url).hostname.endsWith('.example'));
  assert.match(text, /UNVERIFIED/, 'the catalog phase says what is unverified');
});
