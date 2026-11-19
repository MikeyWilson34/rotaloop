// In-app navigation regression test (QA ticket 17): drives the web app in a headless browser
// and fails on any uncaught page error, console error or blank screen.
//
//   npm run web:export && npm run e2e:nav          # serves ./dist on localhost (production build)
//   npm run e2e:nav -- https://rotaloop.expo.app   # the live site, after a deploy
//   npm run e2e:nav -- path/to/export              # any other web export folder
//
// It signs up a fresh guest (real data in the Supabase project the build points at), creates a
// Group through the 3-screen setup (name, jobs with the how-often and time sheets, who's in
// with the invite link, QR code and a typed name), opens Settings → Add Responsibility / Add
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
  // Onboarding is one step now: join or start (no notifications step).
  await expectScreen('onboarding: join or start', /Join or start a group/);
  await click('Start a group');

  // Group setup in 3 screens (simplify ticket 03).
  current = 'create group';
  await expectScreen('setup 1: name your group', /Name your group/);
  await fill('Group name', `E2E Group ${stamp}`);
  await click('Next');
  await expectScreen('setup 2: jobs', /What needs doing, and when\?/);
  await fill('Job 1 name', `E2E Job ${stamp}`);
  await page.getByRole('button', { name: /how often, every Sunday$/ }).click();
  await expectScreen('setup 2: how often sheet', /How often\?/);
  await page.getByRole('radio', { name: 'Every 2 weeks' }).click();
  await click('Done · every other Sunday');
  await page.getByRole('button', { name: /time, 10:00am$/ }).click();
  await expectScreen('setup 2: time sheet', /What time\?/);
  await page.getByRole('checkbox', { name: '9', exact: true }).click();
  await click('Done');
  await expectScreen('setup 2: row updated', /every other Sunday[\s\S]*9:00am/);
  await click('Add another job');
  await fill('Job 2 name', `E2E Coffee ${stamp}`);
  await page.getByRole('radio', { name: 'Headcount' }).last().click();
  await click('Next');
  await expectScreen("setup 3: who's in", /Who's in\?/);
  await expectScreen('setup 3: invite link', /\/join\/[0-9a-f]{64}/);
  await click('Show QR code');
  await expectScreen('setup 3: QR code sheet', /Scan to join/);
  await click('Done');
  await sleep(600);
  await fill('Name', `E2E Standin ${stamp}`);
  await click('Add');
  await expectScreen('setup 3: name added', new RegExp(`E2E Standin ${stamp}`));
  await click('Done');
  await expectScreen('the new Group', /Overview/);
  await groupTab('Schedule').click();
  await expectScreen('the new Group: schedule filled', new RegExp(`E2E Job ${stamp}`));
  await groupTab('Members').click();
  await expectScreen('the new Group: typed name is a member', new RegExp(`E2E Standin ${stamp}`));

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
  await backToGroup('Event Series saved');

  // Group Schedule tab → an Assignment.
  current = 'assignment';
  await groupTab('Schedule').click();
  await expectScreen('Group Schedule', new RegExp(respName));
  await page.locator(`[aria-label^="${respName}"]`).first().click();
  await expectScreen('Assignment (from the Group Schedule)', /Also at this Event|History/);
  if (!page.url().includes('/assignment/')) throw new Error(`Assignment: unexpected URL ${page.url()}`);

  // The cover flow (simplify ticket 07).
  current = 'cover flow';
  // That seat is open (I already have another job that day): anyone may still pick who covers.
  await click("Pick who's covering");
  await expectScreen("cover: Pick who's covering", /Who is covering\?[\s\S]*Someone else/);
  await click('Cancel');
  await sleep(600);
  // My own job that day, from "Also at this Event".
  await page.getByRole('button', { name: `E2E Job ${stamp}: You`, exact: true }).first().click();
  await expectScreen('cover: my turn', /Can't make it/);
  // "Ask the group for cover": the sheet just closes and it needs cover.
  await click("Can't make it");
  await expectScreen("cover: Can't make it? sheet", /Ask the group for cover[\s\S]*I'll find someone to cover/);
  await click('Ask the group for cover');
  await expectScreen('cover: asked the group', /We’ll tell you when someone takes it/);
  if (/Pick how to get it covered/.test(await bodyText())) throw new Error('cover: the sheet stayed open after asking the group');
  await click('I can make it after all');
  await expectScreen('cover: back on', /You’re back on/);
  // "I'll find someone to cover" → "Who is covering?" → "Someone else" (an empty name isn't
  // accepted) → covered straight away, with no swap.
  await click("Can't make it");
  await click("I'll find someone to cover");
  await expectScreen('cover: Who is covering? picker', /Who is covering\?[\s\S]*Someone else/);
  await click('Someone else');
  await expectScreen('cover: their name', /Their name/);
  if (await button('Done').isEnabled()) throw new Error('cover: an empty outside name was accepted');
  await fill('Name', `E2E Outside ${stamp}`);
  await click('Done');
  await expectScreen('cover: outside cover set', new RegExp(`E2E Outside ${stamp}'s covering for you on`));
  await expectScreen('cover: shown as not in group', /not in group/);
  await backToGroup('Assignment');

  // Bottom tabs (Home · Groups · Me), several rounds; Activity is the bell on Home.
  current = 'tabs';
  await page.goto(`${BASE}/`);
  await expectScreen('Home', /Home/);
  // Home is the next 7 days (big card, or "Nothing this week"), then Your groups.
  await expectScreen('Home: this week', /Your next turn|Nothing this week/);
  await expectScreen('Home: your groups', /Your groups/);
  // Home's "Can't make it" opens the same "Can't make it?" sheet (when a turn of mine is this week).
  const homeCant = page.getByRole('button', { name: "Can't make it", exact: true }).filter({ visible: true }).first();
  if (await homeCant.isVisible().catch(() => false)) {
    await homeCant.click();
    await expectScreen("Home → Can't make it? sheet", /Pick how to get it covered[\s\S]*Ask the group for cover/);
    await page.goto(`${BASE}/`);
    await expectScreen('Home again', /Your groups/);
  }
  if (process.env.E2E_SHOTS) {
    // Home at 375px in both schemes, for review (E2E_SHOTS=<folder>).
    await page.setViewportSize({ width: 375, height: 812 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await sleep(500);
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `home-375-${scheme}.png`) });
      await page.mouse.move(187, 400);
      await page.mouse.wheel(0, 2000);
      await sleep(400);
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `home-375-${scheme}-scrolled.png`) });
      await page.mouse.wheel(0, -2000);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByRole('button', { name: new RegExp(`^E2E Group ${stamp}\\. (Your next turn|No turns)`) }).filter({ visible: true }).first().click();
  await expectScreen('Home → the Group', /Overview/);
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expectScreen('the Group → back to Home', /Your groups/);
  const tabCount = await page.getByRole('tab').count();
  if (tabCount !== 3) throw new Error(`Expected 3 bottom tabs, found ${tabCount}`);
  for (let round = 1; round <= 3; round++) {
    for (const [tab, expected] of [
      ['Home', /Home/],
      ['Me', /My dates off/],
      ['Groups', /Create a group/],
      ['Home', /Home/],
    ]) {
      await bottomTab(tab).click();
      await expectScreen(`round ${round}: ${tab} tab`, expected);
    }
    // The bell opens Activity as a pushed page; Back returns to Home.
    await page.getByRole('button', { name: /^Activity/ }).filter({ visible: true }).first().click();
    await expectScreen(`round ${round}: bell → Activity`, /Across all your groups/);
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();
    await expectScreen(`round ${round}: Activity → back`, /Home/);
  }

  // Me → dates off: add one, see it listed, remove it.
  current = 'dates off';
  await bottomTab('Me').click();
  await expectScreen('Me', /My dates off/);
  await page.getByRole('button', { name: 'Add dates off', exact: true }).last().click();
  await expectScreen('Me → Add dates off', /Dates off/);
  // Pick the last day shown in the month (a future day unless it's the month's end; the
  // calendar disables past days, so fall back to any enabled one).
  const days = page.getByRole('checkbox', { name: /^\w+day, \w+ \d+/ }).filter({ visible: true });
  let picked = false;
  for (let i = (await days.count()) - 1; i >= 0 && !picked; i--) {
    if ((await days.nth(i).getAttribute('aria-disabled')) !== 'true') {
      await days.nth(i).click();
      picked = true;
    }
  }
  if (!picked) throw new Error('Dates off: no day to pick');
  await click('Save 1 day');
  await expectScreen('dates off saved', /Dates off saved/);
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expectScreen('dates off → back to Me', /My dates off/);
  const remove = page.getByRole('button', { name: /^Remove dates off:/ }).filter({ visible: true }).first();
  await remove.waitFor();
  await remove.click();
  await expectScreen('remove dates off', /Remove these dates off/);
  await click('Remove');
  await expectScreen('dates off removed', /No dates off yet/);
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
