#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself.
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 6670), drives it, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// The mock actors take the first free block of five ports from 6651-6655, then 6680-6684, 6685-6689, 6690-6694 (MCP_FLOW_STUB_BASE). Uses the Chromium the installed
// Playwright resolves (`npx playwright install chromium` if missing). The run makes no outbound request.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 6670;
if (port < 6650 || port > 6699) { console.error('E2E_PORT must be inside 6650-6699'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const free = (p) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
let stubBase = null;
for (const cand of [6651, 6680, 6685, 6690]) {
  if ((await Promise.all([0, 1, 2, 3, 4].map((i) => free(cand + i)))).every(Boolean)) { stubBase = cand; break; }
}
if (stubBase === null || !(await free(port))) { console.error(`no free port block for the server (${port}) and the five mock actors`); process.exit(2); }
const env = { ...process.env, MCP_FLOW_PORT: String(port), MCP_FLOW_STUB_BASE: String(stubBase) };
delete env.MCP_FLOW_BIND;
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });
const flow = await (await fetch(`${base}/api/flow`)).json();

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const external = []; const errors = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // The browser logs a deliberate 409 (Real is refused) as a console error; it is expected and counted separately.
  let real409 = 0;
  page.on('console', (m) => { if (m.type() === 'error') { if (/status of 409/.test(m.text())) real409 += 1; else errors.push(m.text()); } });
  page.on('dialog', (d) => d.dismiss());
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const status = () => page.getByTestId('run-status').innerText();
  const active = () => page.evaluate(() => `${document.activeElement?.tagName}|${document.activeElement?.getAttribute('data-testid') || document.activeElement?.textContent?.trim().slice(0, 30)}`);
  const nodePos = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => el.style.transform);
  const labelOf = (id) => flow.participants.find((p) => p.id === id).label;
  const waitFinished = () => page.getByTestId('outcome').waitFor({ timeout: 60000 });
  const simulateAndShowAll = async () => {
    await page.getByTestId('simulate').click();
    const showAll = page.getByTestId('showall');
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="showall"]'); return b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
    await showAll.click();
    await waitFinished();
  };

  await page.goto(`${base}/`);
  await page.getByTestId('mode-badge').waitFor();
  check((await page.getByTestId('mode-badge').innerText()).includes('DEMO'), 'header shows the DEMO badge');
  check(/MODE: MOCK/.test(await page.getByTestId('mode-header').innerText()), 'mode header says MOCK');
  const csp = (await fetch(`${base}/`)).headers.get('content-security-policy') || '';
  check(/script-src 'self'/.test(csp) && !/unsafe-eval/.test(csp), 'the page is served with a same-origin CSP');
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge-text').length === 20 && document.querySelectorAll('.react-flow__node').length === 8, null, { timeout: 30000 });
  check((await page.locator('.react-flow__node').count()) === 8 && (await page.locator('.react-flow__edge').count()) === 20, 'diagram shows 8 lifelines and 20 numbered messages');
  check((await page.getByTestId('sim-banner').innerText()).includes('SIMULATION'), 'simulation banner on the Sequence tab');
  await settle(page);
  // Every message label fits inside its arrow: the label must never cover the line and its arrowhead.
  const covered = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map((e) => {
    const t = e.querySelector('.react-flow__edge-text')?.getBoundingClientRect(); const p = e.querySelector('path.react-flow__edge-path')?.getBoundingClientRect();
    return t && p && t.width > p.width - 16 ? e.getAttribute('data-testid') || e.id : null;
  }).filter(Boolean));
  check(covered.length === 0, `no message label covers its arrow${covered.length ? `: ${covered.join(', ')}` : ''}`);
  await shot('1-ready-light');

  // Banner, Mock | Real toggle and Reset in the header on every tab
  for (const name of ['Interlocks', 'What is real', 'Sequence']) {
    await page.getByRole('button', { name, exact: true }).click();
    check(await page.getByTestId('sim-banner').isVisible(), `banner visible on the ${name} tab`);
    check(await page.getByTestId('mode-mock').isVisible() && (await page.getByTestId('mode-mock').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('mode-real').getAttribute('aria-pressed')) === 'false' && await page.getByTestId('reset').isVisible(), `Mock | Real toggle (Mock pressed) and Reset in the header on the ${name} tab`);
    check(/MOCK mode/.test(await page.getByTestId('sim-banner').innerText()), `the banner names the Mock mode on the ${name} tab`);
  }
  check(await page.locator('main').count() === 1, 'one main landmark');
  // Real is refused with an honest message and the page stays in Mock
  // Real is shown but disabled (aria-disabled, still focusable) and its title says why; the page stays in Mock.
  await page.waitForFunction(() => document.querySelector('[data-testid="mode-real"]')?.getAttribute('aria-disabled') === 'true', null, { timeout: 15000 });
  const realTitle = (await page.getByTestId('mode-real').getAttribute('title')) || '';
  check(/Live mode is not available/.test(realTitle), `Real is disabled and its title explains why: "${realTitle.slice(0, 80)}"`);
  check((await page.getByTestId('mode-mock').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('mode-real').getAttribute('aria-pressed')) === 'false' && /MODE: MOCK/.test(await page.getByTestId('mode-header').innerText()), 'the page stays in Mock');
  await page.getByTestId('mode-mock').click();
  check((await page.getByTestId('mode-note').innerText()) === '', 'choosing Mock leaves no note');
  // P and Esc
  await page.keyboard.press('p');
  check((await page.getByTestId('presenter').getAttribute('aria-pressed')) === 'true' && await page.getByTestId('sim-banner').isVisible() && await page.getByTestId('mode-real').isVisible(), 'P turns presenter mode on; the banner and the Mock | Real toggle stay');
  await page.keyboard.press('Control+p');
  check((await page.getByTestId('presenter').getAttribute('aria-pressed')) === 'true', 'Ctrl+P is ignored');
  await page.keyboard.press('Escape');
  check((await page.getByTestId('presenter').getAttribute('aria-pressed')) === 'false', 'Esc leaves presenter mode');

  // Keyboard only: Tab to Simulate and press Enter
  await page.goto(`${base}/`);
  await page.getByTestId('mode-badge').waitFor();
  await page.keyboard.press('Tab');
  check((await active()).includes('Skip to content'), 'first Tab stop is the skip link');
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await active()).endsWith('|simulate'); }
  check(reached, 'Tab reaches Simulate');
  await page.getByTestId('speed').selectOption('4');
  await page.getByTestId('simulate').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('outcome').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="simulate"]').getAttribute('aria-disabled') !== 'true', null, { timeout: 30000 });
  check((await active()).endsWith('|simulate'), `keyboard focus is still on Simulate after the run (now: ${await active()})`);
  check((await page.getByTestId('run-status').getAttribute('aria-live')) === 'polite', 'the step caption is an aria-live region');
  check(/Message 20 of 20/.test(await status()) && /every check passed/.test(await status()), `happy path reached the last message: "${await status()}"`);
  check((await page.locator('[data-testid^="frame-"][data-status="ok"]').count()) === 20, 'all 20 reel frames are ok');
  check(/widget-100 costs/.test(await page.getByTestId('outcome').innerText()), 'the assistant answer is shown');

  // Catalog phase: organisational label, UNVERIFIED, the connector appears not signed in
  await page.getByTestId('frame-2').click();
  check(await page.getByTestId('org-badge').isVisible() && /ORGANISATIONAL STEP/.test(await page.getByTestId('wire').innerText()) && /UNVERIFIED/.test(await page.getByTestId('wire').innerText()), 'message 2 is labelled an organisational step and UNVERIFIED');
  await page.getByTestId('frame-4').click();
  const w4 = await page.getByTestId('wire').innerText();
  check(/added, not signed in/.test(w4) && /UNVERIFIED/.test(w4), 'message 4 shows the connector as "added, not signed in"');
  check((await page.locator('.story li[data-phase="catalog"]').count()) === 1, 'the story strip opens with the catalog phase');

  // Reel + details row + wire form
  let onFrame = false;
  await page.getByTestId('pause').focus().catch(() => {});
  for (let i = 0; i < 30 && !onFrame; i++) { await page.keyboard.press('Tab'); onFrame = /\|frame-/.test(await active()); }
  check(onFrame, 'Tab reaches a reel frame');
  await page.getByTestId('frame-14').click();
  const details = await page.getByTestId('details-row').innerText();
  check(/AI assistant/.test(details) && /PingFederate/.test(details) && /PKCE/.test(details), 'details row names both participants of message 14');
  const wire = await page.getByTestId('wire').innerText();
  check(/code_verifier/.test(wire) && /UNVERIFIED/.test(wire), 'wire form shows the real redemption request and the UNVERIFIED label');
  await page.getByTestId('frame-15').click();
  const w11 = await page.getByTestId('wire').innerText();
  check(/MOCK-ISSUED/.test(w11) && /"aud"/.test(w11), 'access-token step shows a MOCK-ISSUED token with its claims');
  await page.getByTestId('frame-17').click();
  check(/"act"/.test(await page.getByTestId('wire').innerText()), 'the exchange step shows the act claim');
  await shot('2-happy-light');

  // Drag a box, then Reset restores it
  const before = await nodePos('client');
  await page.getByTestId('box-client').locator('.fbox').scrollIntoViewIfNeeded();
  const box = await page.getByTestId('box-client').locator('.fbox').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 120, { steps: 8 });
  await page.mouse.move(box.x + 70, box.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(([sel, t]) => document.querySelector(sel)?.style.transform !== t, ['.react-flow__node[data-id="client"]', before], { timeout: 15000 }).catch(() => {});
  const moved = await nodePos('client');
  check(moved !== before, `a box can be dragged (${before} -> ${moved})`);
  await page.getByTestId('reset').click();
  await page.waitForFunction(([sel, t]) => document.querySelector(sel)?.style.transform === t, ['.react-flow__node[data-id="client"]', before]);
  check((await nodePos('client')) === before, 'Reset restores the box position');
  check((await page.locator('[data-testid^="frame-"][data-status="ok"]').count()) === 0 && /Ready/.test(await status()), 'Reset clears the run');

  // Keyboard: Tab-focus a box, Enter selects it, the arrow keys move it; Reset puts it back
  const kbBefore = await nodePos('pf');
  await page.waitForFunction(() => { const n = document.querySelector('.react-flow__node[data-id="pf"]'); n?.focus(); return document.activeElement === n; }, null, { timeout: 15000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="pf"]')?.classList.contains('selected'), null, { timeout: 15000 }).catch(() => {});
  check(await page.locator('.react-flow__node[data-id="pf"].selected').count() === 1, 'Enter selects a focused box');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(([sel, t]) => document.querySelector(sel)?.style.transform !== t, ['.react-flow__node[data-id="pf"]', kbBefore], { timeout: 15000 }).catch(() => {});
  const kbAfter = await nodePos('pf');
  check(kbAfter !== kbBefore, `the arrow keys move a selected box (${kbBefore} -> ${kbAfter})`);
  await page.getByTestId('reset').click();
  await page.waitForFunction(([sel, t]) => document.querySelector(sel)?.style.transform === t, ['.react-flow__node[data-id="pf"]', kbBefore]);
  check((await nodePos('pf')) === kbBefore, 'Reset restores the keyboard-moved box');

  // Every mistake toggle
  for (const m of flow.mistakes) {
    await page.getByTestId(`mistake-${m.id}`).check({ force: true });
    await simulateAndShowAll();
    const out = await page.getByTestId('outcome').innerText();
    const cap = await status();
    const ok = out.includes('The interlock held') && out.includes(labelOf(m.expected.actor)) && out.includes(`message ${m.expected.step}`) && out.includes(m.expected.error);
    check(ok, `mistake ${m.id}: ${labelOf(m.expected.actor)} refuses message ${m.expected.step} with ${m.expected.error}`);
    check(/Refused by/.test(cap) && cap.includes(`Message ${m.expected.step} of 20`), `${m.id}: the live caption announces the refusal`);
    if (m.id === 'wrong_verifier') await shot('3-refusal-light');
  }
  await page.getByTestId('mistake-none').check({ force: true });

  // Interlocks tab: run all
  await page.getByRole('button', { name: 'Interlocks', exact: true }).click();
  await page.getByRole('button', { name: /^Run all/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="result-"] .status--ok').length === n, flow.mistakes.length, { timeout: 90000 });
  check(true, `Interlocks tab: all ${flow.mistakes.length} checks held`);
  await shot('4-interlocks-light');
  await page.getByRole('button', { name: 'What is real', exact: true }).click();
  check(/UNVERIFIED/.test(await page.locator('main').innerText()), 'What is real tab labels product behaviour UNVERIFIED');
  await page.getByRole('button', { name: 'Sequence', exact: true }).click();

  // Presenter mode keeps the banner
  await page.getByTestId('presenter').click();
  check(await page.getByTestId('sim-banner').isVisible() && (await page.getByRole('button', { name: 'Interlocks', exact: true }).count()) === 0, 'presenter mode keeps the banner');
  await simulateAndShowAll();
  await shot('5-presenter-light');
  await page.getByTestId('presenter').click();

  // Dark theme
  await page.getByTestId('theme').selectOption('dark');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme toggles to dark');
  await page.getByTestId('frame-14').click();
  await settle(page);
  await shot('6-sequence-dark');
  await page.getByTestId('mistake-wrong_audience').check({ force: true });
  await simulateAndShowAll();
  await shot('7-refusal-dark');

  // 375px: no horizontal scroll, either theme, every tab
  await page.setViewportSize({ width: 375, height: 844 });
  await settle(page);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByTestId('theme').selectOption('light');
    for (const name of ['Sequence', 'Interlocks', 'What is real']) {
      await page.getByRole('button', { name, exact: true }).click();
      const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      check(w.s <= w.c, `375px ${theme} ${name}: no horizontal scroll (${w.s} <= ${w.c})`);
    }
  }
  await page.getByRole('button', { name: 'Sequence', exact: true }).click();
  const scroll = await page.evaluate(() => { const e = document.querySelector('.flow-scroll'); return { s: e.scrollWidth, c: e.clientWidth }; });
  check(scroll.s > scroll.c, `375px: the diagram scrolls inside its own frame instead of shrinking (${scroll.s} > ${scroll.c})`);
  await shot('8-mobile-light');

  check(external.length === 0, `no off-origin requests${external.length ? `: ${external.join(', ')}` : ''}`);
  check(real409 === 0, `the disabled Real button sent no refused request (${real409})`);
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  failures += 1;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
