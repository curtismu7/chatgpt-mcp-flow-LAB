// Neutrality scanning. The repo must contain no customer, company, person or identity-provider name, no real hostname
// and no customer-specific scope or business term. The words themselves are never written down here:
//  - the built-in tokens are assembled from pieces at runtime;
//  - the hidden list is read from a file outside the repo and is never printed (findings name a file and an index only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const j = (...p) => p.join('');
// Word-boundary regexes (case-insensitive) assembled from pieces.
export const BUILTIN = [
  { id: 'builtin-1', re: new RegExp(`\\b${j('u', 'h', 'g')}\\b`, 'i') },
  { id: 'builtin-2', re: new RegExp(`\\b${j('hs', 'id')}\\b`, 'i') },
  { id: 'builtin-3', re: new RegExp(j('united', '\\s?', 'health'), 'i') },
  { id: 'builtin-4', re: new RegExp(`\\b${j('opt', 'um')}\\b`, 'i') },
  { id: 'builtin-5', re: new RegExp(j('rx', '[.-]', 'price'), 'i') },
  { id: 'builtin-6', re: new RegExp(j('rx', '-member'), 'i') },
  { id: 'builtin-7', re: new RegExp(j('digital', '[ -]?', 'front', '[ -]?', 'door'), 'i') },
  { id: 'builtin-8', re: new RegExp(j('mcp', '\\.', 'u', 'h', 'g'), 'i') },
];
// github.com is NOT an allowed host. Only two exact URL prefixes are allowed: this repo's own curtismu7 URL in the docs,
// and the gitleaks release download in ci.yml. Any other github.com URL (for example a real customer org) is a finding.
const ALLOWED_HOST = /(^|\.)(example|invalid)$|^localhost$|^127\.0\.0\.1$|^\[::1\]$|^\$\{?[A-Z_]+/;
const ALLOWED_GITHUB_PATH = /^\/(curtismu7\/chatgpt-mcp-flow-LAB(?:\.git)?(?![A-Za-z0-9._-])|gitleaks\/gitleaks\/releases\/download\/)/;
const URL_RE = /\bhttps?:\/\/(?:[^\s/@'"`]*@)?([A-Za-z0-9.[\]-]+)(\/[^\s'"`)>\]]*)?/g;
export const urlAllowed = (host, urlPath = '') => {
  const h = host.replace(/\.$/, '');
  if (h.toLowerCase() === 'github.com') return ALLOWED_GITHUB_PATH.test(urlPath);
  return ALLOWED_HOST.test(h);
};

export const defaultListPath = () => process.env.FORBIDDEN_STRINGS_FILE || path.join(os.homedir(), '.config', 'demo-kit', 'forbidden-strings.txt');
export function readHiddenList(file = defaultListPath()) {
  try { return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0); } catch { return null; }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); } else if (e.isFile()) out.push(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

const isLock = (f) => path.basename(f) === 'package-lock.json';
const read = (f) => { try { const b = fs.readFileSync(f); return b.includes(0) ? '' : b.toString('utf8'); } catch { return ''; } };

// Returns [{ file, rule }]: file names and rule ids only, never the matched text.
export function scanTree(root, hidden) {
  const hits = [];
  for (const f of listFiles(root)) {
    const rel = path.relative(root, f);
    const text = read(f);
    if (!isLock(f)) {
      for (const b of BUILTIN) if (b.re.test(text)) hits.push({ file: rel, rule: b.id });
      for (const m of text.matchAll(URL_RE)) if (!urlAllowed(m[1], m[2])) { hits.push({ file: rel, rule: 'real-hostname' }); break; }
    }
    if (hidden) hidden.forEach((s, i) => { if (text.includes(s)) hits.push({ file: rel, rule: `hidden-${i + 1}` }); });
  }
  return hits;
}

// History scan: all commit messages and diffs. Returns rule ids only.
export function scanHistory(root, hidden) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const r = spawnSync('git', ['log', '-p', '--all'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const hits = [];
  const text = r.stdout;
  for (const b of BUILTIN) if (b.re.test(text)) hits.push({ file: '(git history)', rule: b.id });
  if (hidden) hidden.forEach((s, i) => { if (text.includes(s)) hits.push({ file: '(git history)', rule: `hidden-${i + 1}` }); });
  return hits;
}
