// Owner rule: a product claim with no source is labelled UNVERIFIED. The claims that a member adds a connector
// "for free" or with "nothing to install" are such claims, so every line that states one must carry the label on the
// same line. Changelog history and test fixtures are not product text and are skipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.data']);
const SKIP_FILES = new Set(['CHANGELOG.md', 'package-lock.json']);
const EXTS = new Set(['.md', '.js', '.jsx', '.mjs', '.json']);
const CLAIM = /for free|nothing to install/i;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(path.join(dir, e.name));
    const full = path.join(dir, e.name);
    if (SKIP_FILES.has(e.name) || !EXTS.has(path.extname(e.name)) || /\.test\.[a-z]+$/.test(e.name)) return [];
    return [full];
  });
}

test('every line that claims a free add or nothing to install carries UNVERIFIED on the same line', () => {
  const bad = [];
  for (const file of walk(root)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (CLAIM.test(line) && !line.includes('UNVERIFIED')) bad.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
