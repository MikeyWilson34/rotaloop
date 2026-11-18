// In-app navigation regression test (QA ticket 17): drives the web app in a headless browser
// and fails on any uncaught page error, console error or blank screen.
//
//   npm run web:export && npm run e2e:nav          # serves ./dist on localhost (production build)
//   npm run e2e:nav -- https://rotaloop.expo.app   # the live site, after a deploy
//   npm run e2e:nav -- path/to/export              # any other web export folder
//
// It signs up a fresh guest (real data in the Supabase project the build points at), creates a
// Group, taps every Overview checklist item in-app, opens Settings → Add Responsibility / Add
// Event Series, saves one of each, opens an Assignment from the Group's Schedule tab and
// cycles the bottom tabs. It also reports how many requests the cold load made.
//
// Browser: Microsoft Edge on Windows, Chrome elsewhere (via playwright-core, no download).
// Set E2E_BROWSER=<path to a Chromium-based browser> to use another one, E2E_HEADED=1 to watch.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const target = process.argv[2] ?? 'dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Serving a local export like EAS Hosting does for `web.output: 'single'` (SPA fallback).

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

async function serve(dir) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`${root}/index.html not found: run \`npm run web:export\` first, or pass a URL.`);
  }
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://localhost:${server.address().port}`, close: () => server.close() };
}

// ---------------------------------------------------------------------------

const isUrl = /^https?:\/\//.test(target);
const server = isUrl ? null : await serve(target);
const BASE = (isUrl ? target : server.base).replace(/\/$/, '');

const launch = {
  headless: !process.env.E2E_HEADED,
  ...(process.env.E2E_BROWSER
    ? { executablePath: process.env.E2E_BROWSER }
    : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' }),
};
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

const problems = [];
let requests = 0;
let failed = 0;
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 400)}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 400)}`);
});
page.on('request', () => requests++);
page.on('response', (r) => {
  if (r.status() >= 400 && new URL(r.url()).origin === new URL(BASE).origin) {
    failed++;
    problems.push(`HTTP ${r.status()} ${r.url().slice(0, 200)}`);
  }
});

const results = [];
let current = 'start';

const rootText = () => page.evaluate(() => document.getElementById('root')?.innerText ?? '');
// Sheets (React Native Web modals) render outside #root.
const bodyText = () => page.evaluate(() => document.body.innerText);

/** Waits for the screen to show `expected`, then fails on a blank root or any error so far. */
async function expectScreen(tag, expected) {
  const pattern = expected instanceof RegExp ? expected : new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const deadline = Date.now() + 20_000;
  let text = '';
  while (Date.now() < deadline) {
    text = await bodyText();
    if (pattern.test(text) || problems.length) break;
    await sleep(250);
  }
  await sleep(500); // let effects (realtime subscriptions) run
  const root = await rootText();
  text = await bodyText();
  const path = page.url().replace(BASE, '') || '/';
  if (problems.length) throw new Error(`${tag}: ${problems.join(' | ')}`);
  if (!root.trim()) throw new Error(`${tag}: blank root at ${path}`);
  if (!pattern.test(text)) throw new Error(`${tag}: expected ${pattern} at ${path}, saw "${text.slice(0, 200).replace(/\n/g, ' / ')}"`);
  results.push(`ok  ${tag}  (${path})`);
  console.log(`ok  ${tag}  (${path})`);
}

const button = (name) => page.getByRole('button', { name, exact: true }).last();
const click = async (name) => {
  await button(name).click();
};
const fill = async (label, value) => page.getByLabel(label, { exact: true }).last().fill(value);
const groupTab = (name) => page.getByRole('tab', { name, exact: true }).first();

/** Taps the screen's Back button until the Group screen (its tabs) shows again. */
async function backToGroup(tag) {
  for (let i = 0; i < 3; i++) {
    if (await groupTab('Overview').isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();
    await sleep(800);
  }
  await expectScreen(`${tag} → back to the Group`, /Overview/);
}

const bottomTab = (name) =>
  page
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .or(page.getByRole('link', { name: new RegExp(`^${name}`) }))
    .last();

const stamp = Date.now().toString(36).slice(-4);
const first = 'E2E';
const last = `Nav ${stamp}`;
const me = `${first} ${last}`;
const respName = `E2E Greeter ${stamp}`;

let exitCode = 0;
try {
  current = 'cold load';
  await page.goto(`${BASE}/`);
  await expectScreen('cold load: welcome', /Get started/);
  console.log(`    cold load: ${requests} requests (${failed} failed)`);
  const coldRequests = requests;

  current = 'sign up';
  await click('Get started');
  await expectScreen('name step', /First name/);
  await fill('First name', first);
  await fill('Last name', last);
  await click('Continue');
  await expectScreen('onboarding: notifications', /Stay in the loop/i);
  await click('Continue');
  await page.getByRole('radio', { name: 'Create a group' }).click();
  await expectScreen('onboarding: join or create', /Create a group/);
  await click('Create group');
  await expectScreen('create group', /Group name/);
  await fill('Group name', `E2E Group ${stamp}`);
  await click('Create group');
  await expectScreen('the new Group', /Set up your group/i);

  // The Overview checklist, in-app (the QA blocker: these blanked the app).
  current = 'checklist';
  const item = (label) => page.getByRole('button', { name: new RegExp(`^${label.replace(/'/g, "'")}`) }).first();
  for (const [label, expected] of [
    ['Add Responsibilities', /Add Responsibility/],
    ['Choose each team', /Responsibility/],
    ['Set when Events happen', /Event Series/],
  ]) {
    await item(label).click();
    await expectScreen(`checklist: ${label}`, expected);
    await backToGroup(`checklist: ${label}`);
  }
  await item('Invite people').click();
  await expectScreen('checklist: Invite people', /Copy link/);
  await click('Done');
  await sleep(600);
  await expectScreen('invite sheet closed', /Set up your group/i);

  // Settings → Add Responsibility (saved, with this person Qualified).
  current = 'settings';
  await groupTab('Settings').click();
  await expectScreen('Group Settings', /Add Responsibility/);
  await click('Add Responsibility');
  await expectScreen('Settings → Add Responsibility', /Name/);
  await fill('Name', respName);
  const meChip = page.getByRole('checkbox', { name: me, exact: true });
  if ((await meChip.getAttribute('aria-checked')) !== 'true') await meChip.click();
  if ((await meChip.getAttribute('aria-checked')) !== 'true') throw new Error('Chip has no aria-checked state');
  await click('Add Responsibility');
  await expectScreen('Responsibility saved', new RegExp(respName));
  await backToGroup('Responsibility saved');

  // Settings → Add Event Series (saved, for that Responsibility).
  if (!(await button('Add Event Series').isVisible().catch(() => false))) await groupTab('Settings').click();
  await click('Add Event Series');
  await expectScreen('Settings → Add Event Series', /Preview|Name/);
  await fill('Name', `E2E Sundays ${stamp}`);
  const respChip = page.getByRole('checkbox', { name: respName, exact: true });
  if ((await respChip.count()) && (await respChip.getAttribute('aria-checked')) !== 'true') await respChip.click();
  await click('Add Event Series');
  await sleep(1500);
  await backToGroup('Event Series saved');

  // Group Schedule tab → an Assignment.
  current = 'assignment';
  await groupTab('Schedule').click();
  await expectScreen('Group Schedule', new RegExp(respName));
  await page.locator(`[aria-label^="${respName}"]`).first().click();
  await expectScreen('Assignment (from the Group Schedule)', /Also at this Event|History/);
  if (!page.url().includes('/assignment/')) throw new Error(`Assignment: unexpected URL ${page.url()}`);
  await backToGroup('Assignment');

  // Bottom tabs, several rounds (Home, Schedule and Activity share live subscriptions).
  current = 'tabs';
  await page.goto(`${BASE}/`);
  await expectScreen('Home', /Home/);
  for (let round = 1; round <= 3; round++) {
    for (const [tab, expected] of [
      ['Home', /Home/],
      ['Schedule', /Schedule/],
      ['Activity', /Activity/],
      ['Home', /Home/],
      ['Schedule', /Schedule/],
    ]) {
      await bottomTab(tab).click();
      await expectScreen(`round ${round}: ${tab} tab`, expected);
    }
  }
  // And into a Group and back out, with the tabs still mounted underneath.
  await bottomTab('Groups').click();
  await expectScreen('Groups tab', /Create a group/);
  // Other tab screens stay mounted (hidden): pick the card that's on screen.
  const cards = await page.getByRole('button', { name: new RegExp(`^E2E Group ${stamp}`) }).all();
  let card = null;
  for (const c of cards) if (await c.isVisible()) card = c;
  if (!card) throw new Error('Groups tab: the new Group card is not on screen');
  await card.click();
  await expectScreen('Groups → the Group', /Overview/);
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expectScreen('back to Groups', /Groups/);

  console.log(`\nPASS: ${results.length} checks against ${BASE} (cold load ${coldRequests} requests)`);
} catch (error) {
  exitCode = 1;
  console.error(`\nFAIL during "${current}": ${error.message}`);
  try {
    const shot = resolve('e2e-nav-failure.png');
    await page.screenshot({ path: shot });
    console.error(`Screenshot: ${shot}`);
  } catch {
    // ignore
  }
} finally {
  await browser.close();
  server?.close();
}
process.exit(exitCode);
