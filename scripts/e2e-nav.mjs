// In-app navigation regression test (QA ticket 17): drives the web app in a headless browser
// and fails on any uncaught page error, console error or blank screen.
//
//   npm run web:export && npm run e2e:nav          # serves ./dist on localhost (production build)
//   npm run e2e:nav -- https://rotaloop.expo.app   # the live site, after a deploy
//   npm run e2e:nav -- path/to/export              # any other web export folder
//
// It signs up a fresh guest (real data in the Supabase project the build points at), creates a
// Group through the 3-screen setup (name, jobs with the how-often and time sheets, who's in
// with the invite link, QR code and a typed name), checks the one-page group (Coming up, the
// stand-in in Members), changes a job's turn order in group settings, opens a turn's sheet and its details page, runs the cover flow
// (ask the group, pick who's covering, take it back, an outside cover by name), edits and adds a job in
// group settings, and cycles the bottom tabs. It also reports how many requests the cold load made.
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
/** Taps Back until the group page (its "Coming up" section) shows again. */
async function backToGroup(tag) {
  for (let i = 0; i < 3; i++) {
    if (await page.getByRole('button', { name: 'Group settings', exact: true }).isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();
    await sleep(800);
  }
  await expectScreen(`${tag} → back to the group`, /Coming up/);
}

/** Screenshots the current screen at 375px in light and dark (E2E_SHOTS=<folder>). */
async function shoot(name) {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await sleep(500);
    await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name}-375-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
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
const jobName = `E2E Job ${stamp}`;
const renamed = `E2E Teach ${stamp}`;
const addedJob = `E2E Setup ${stamp}`;
// A second stand-in with its own first name, so the turn-order step can tell people apart.
const second = 'Zoe';
const multiName = `E2E Multi ${stamp}`;

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
  // Several weekdays for one job (feedback-2 ticket 01): Tue + Thu + Sat, same time.
  await click('Add another job');
  await fill('Job 3 name', multiName);
  await page.locator(`[aria-label^="${multiName}: how often"]`).filter({ visible: true }).first().click();
  await expectScreen('setup 2: how often sheet (days)', /Which days\?[\s\S]*Same time on each day/);
  for (const day of ['Tuesday', 'Thursday', 'Saturday']) await page.getByRole('checkbox', { name: day, exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sunday', exact: true }).click();
  await click('Done · every Tue, Thu, Sat');
  await expectScreen('setup 2: several days row', /every Tue, Thu, Sat/);
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
  await fill('Name', `${second} Standin ${stamp}`);
  await click('Add');
  await expectScreen('setup 3: second name added', new RegExp(`${second} Standin ${stamp}`));
  await click('Done');
  // One scrolling group page (simplify ticket 06): Coming up, then Members.
  await expectScreen('the new group: coming up', /Coming up/);
  await expectScreen('the new group: schedule filled', new RegExp(jobName));
  // Several weekdays: the multi-day job's dates fall on Tue, Thu and Sat only.
  {
    const labels = await page.locator(`[aria-label^="${multiName},"]`).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const days = new Set(labels.map((l) => (l.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\b/) ?? [])[1]).filter(Boolean));
    if (!labels.length || ['Tue', 'Thu', 'Sat'].some((d) => !days.has(d)) || [...days].some((d) => !['Tue', 'Thu', 'Sat'].includes(d))) {
      throw new Error(`several weekdays: expected dates only on Tue, Thu, Sat, got ${[...days].join(', ') || 'none'} from ${labels.slice(0, 4).join(' | ')}`);
    }
  }
  await expectScreen('the new group: typed name is a stand-in', new RegExp(`E2E Standin ${stamp}[\\s\\S]*Stand-in`));
  // Invite from the group page (feedback-2 ticket 03): no trip through settings.
  // Feedback-2 ticket 04: you're the only real member, so the invite card sits in the
  // page between Coming up and Members ("Invite") and not repeated under Members; "Add a stand-in" is a small link.
  await expectScreen('group page: invite card between Coming up and Members when you are the only member', /Coming up[\s\S]*Share the turns\. Everyone gets their own reminders\.[\s\S]*Members/);
  if (process.env.E2E_SHOTS) {
    await sleep(4500); // let the 'schedule is ready' toast go
    await page.getByRole('button', { name: 'Invite people', exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
    await shoot('group-solo-invite-card');
    await page.getByRole('button', { name: 'Add a stand-in', exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
    await shoot('group-members-standins');
  }
  await page.getByRole('button', { name: 'Invite people', exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await click('Invite people');
  await expectScreen('group page: invite sheet shows the join link', /Anyone with this link[\s\S]*\/join\/[0-9a-f]{64}/);
  if (process.env.E2E_SHOTS) await shoot('group-invite-sheet');
  await click('Done');
  await sleep(600);
  // "Invite <first name>" on a stand-in's row opens that person's own link.
  await page.getByRole('button', { name: 'Invite E2E', exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await click('Invite E2E');
  await expectScreen("stand-in row: Invite opens that person's own link", new RegExp(`Invite E2E Standin ${stamp}[\\s\\S]*just for[\\s\\S]*[0-9a-f]{64}`));
  await click('Done');
  await sleep(600);

  // Headcount jobs (simplify ticket 09): Coffee asks "Coming?" instead of taking turns. This
  // needs the 20261124000000_headcount_jobs migration and the new group-command function; until
  // both are deployed the server makes Coffee a take-turns job, and these steps are skipped.
  current = 'headcount';
  const coffeeRow = page.locator(`[aria-label^="E2E Coffee ${stamp},"][aria-label$="Coming?"]`).filter({ visible: true }).first();
  if (await coffeeRow.isVisible().catch(() => false)) {
    await expectScreen('headcount row: counts', /0 coming · 0 not · 3 no reply/);
    await coffeeRow.click();
    await expectScreen('headcount sheet: Coming? and the stand-in', /Coming\?[\s\S]*Not on the app/);
    await click('Yes');
    await expectScreen('headcount: I said yes', /1 coming · 0 not · 2 no reply/);
    await click(`No for E2E Standin ${stamp}`);
    await expectScreen('headcount: answered for the stand-in', /1 coming · 1 not · 1 no reply/);
    await click('Close');
    await sleep(600);
    await expectScreen("headcount row: you're coming", /You're coming/);
  } else {
    const note = 'skip  headcount steps: the server has no headcount jobs yet (apply the migration, deploy group-command)';
    results.push(note);
    console.log(note);
  }

  // Turn order in group settings (feedback-2 ticket 02): move the last person to the top, save,
  // and the job's next date on the group page is theirs. Done before any cover, so nothing is
  // pinned and the new order starts at the next date.
  current = 'turn order';
  await click('Group settings');
  await expectScreen('settings: Turn order section', /Turn order[\s\S]*Next: [\s\S]*Change the order[\s\S]*Dates off/);
  if (process.env.E2E_SHOTS) await shoot('settings-turn-order');
  await page.getByRole('button', { name: new RegExp(`^Turn order for ${jobName}:`) }).filter({ visible: true }).first().click();
  await expectScreen('Turn order sheet', /Use the arrows to move people up or down/);
  await expectScreen('Turn order sheet: the last person is the second stand-in', new RegExp(`${second}\\s*Save`));
  if (await button(`Move ${second} later`).isEnabled()) throw new Error('Turn order: the last row can still move later');
  if (process.env.E2E_SHOTS) await shoot('turn-order-sheet');
  await click(`Move ${second} earlier`);
  await click(`Move ${second} earlier`);
  if (await button(`Move ${second} earlier`).isEnabled()) throw new Error('Turn order: the top row can still move earlier');
  await click('Save');
  await expectScreen('Turn order saved', /Turn order saved/);
  await expectScreen('settings: next is the moved person', new RegExp(`Next: ${second} · Change the order`));
  await backToGroup('turn order');
  const nextTurn = page.locator(`[aria-label^="${jobName},"]`).filter({ visible: true }).first();
  await nextTurn.waitFor();
  const nextLabel = (await nextTurn.getAttribute('aria-label')) ?? '';
  if (![`, ${second}`, `, ${second} (Stand-in)`].some((end) => nextLabel.endsWith(end))) {
    throw new Error(`Turn order: the next date shows "${nextLabel}", expected ${second}`);
  }
  results.push(`ok  turn order: the next date is ${second}'s`);
  console.log(`ok  turn order: the next date is ${second}'s`);

  // A turn → its details sheet → the full details page → back.
  current = 'turn';
  await page.locator(`[aria-label^="${jobName}"]`).filter({ visible: true }).first().click();
  await expectScreen('turn details sheet', /See details/);
  await click('See details');
  await expectScreen('turn details page', /History/);
  if (!page.url().includes('/assignment/')) throw new Error(`Turn details: unexpected URL ${page.url()}`);
  await backToGroup('turn details');

  // The cover flow (simplify ticket 07), from the group page's turn sheet.
  current = 'cover flow';
  // Coming up shows 5 dates at a time. After the turn-order step Zoe has the next E2E Job date
  // and the twice-weekly-plus job fills the first dates, so my E2E Job turn can sit further down:
  // tap "Show more dates" until it is listed.
  const myTurnLocator = () =>
    page.locator(`[aria-label^="${jobName}"][aria-label$=", You"]`).filter({ visible: true }).first();
  async function myTurn() {
    for (let i = 0; i < 6 && (await myTurnLocator().count()) === 0; i++) {
      const more = page.getByRole('button', { name: 'Show more dates', exact: true }).filter({ visible: true }).first();
      if (!(await more.isVisible().catch(() => false))) break;
      await more.click();
      await sleep(400);
    }
    return myTurnLocator();
  }
  const needsCoverTurn = () =>
    page.locator(`[aria-label^="${jobName}"][aria-label$="Needs cover"]`).filter({ visible: true }).first();
  // "Can't make it" → "Can't make it?" → "Ask the group for cover": the sheet just closes.
  await (await myTurn()).click();
  await click("Can't make it");
  await expectScreen("cover: Can't make it? sheet", /Pick how to get it covered[\s\S]*Ask the group for cover[\s\S]*I'll find someone to cover/);
  await click('Ask the group for cover');
  await expectScreen('cover: asked the group, turn needs cover', /Needs cover/);
  await sleep(600);
  if (/Pick how to get it covered/.test(await bodyText())) throw new Error('cover: the sheet stayed open after asking the group');
  // The open turn: "Pick who's covering" lists everyone else and "Someone else"; then take it back.
  await needsCoverTurn().click();
  await expectScreen('cover: my open request', /We’ll tell you when someone takes it/);
  await click("Pick who's covering");
  await expectScreen("cover: Pick who's covering", /Who is covering\?[\s\S]*E2E Standin[\s\S]*Someone else/);
  await click('Cancel');
  await sleep(600);
  await needsCoverTurn().click();
  await click('I can make it after all');
  await expectScreen("cover: I can make it after all", /You're back on/);
  await sleep(600);
  // "I'll find someone to cover" → "Someone else" (an empty name isn't accepted) → covered.
  await (await myTurn()).click();
  await click("Can't make it");
  await click("I'll find someone to cover");
  await expectScreen('cover: Who is covering? picker', /Who is covering\?[\s\S]*Someone else/);
  await click('Someone else');
  await expectScreen('cover: their name', /Their name/);
  if (await button('Done').isEnabled()) throw new Error('cover: an empty outside name was accepted');
  await fill('Name', `E2E Outside ${stamp}`);
  await click('Done');
  await expectScreen('cover: outside cover message', new RegExp(`E2E Outside ${stamp}'s covering for you on`));
  await expectScreen("cover: outside cover on the group page", /E2E[\s\S]*Not in group/);

  // Gear → settings: edit a job (rename it), add a job.
  current = 'settings';
  await click('Group settings');
  await expectScreen('group settings', /Jobs[\s\S]*Dates off[\s\S]*Invite link/);
  await page.getByRole('button', { name: new RegExp(`^${jobName},`) }).filter({ visible: true }).first().click();
  await expectScreen('edit job sheet', /Edit job/);
  await fill('Job 1 name', renamed);
  await click('Save job');
  await expectScreen('job saved', new RegExp(renamed));
  await click('Add a job');
  await expectScreen('add job sheet', /Add a job/);
  await fill('Job 1 name', addedJob);
  await click('Add job');
  await expectScreen('job added', new RegExp(addedJob));
  await click('More options');
  await expectScreen('more options', /Time zone/);
  await backToGroup('settings');
  await expectScreen('renamed job on the group page', new RegExp(renamed));

  // Bottom tabs (Home · Groups · Me), several rounds; Activity is the bell on Home.
  current = 'tabs';
  await page.goto(`${BASE}/`);
  await expectScreen('Home', /Home/);
  // Home is the next 7 days (big card, or "Nothing this week"), then Your groups.
  await expectScreen('Home: this week', /Your next turn|Coming\?|Nothing this week|You're all set/);
  await expectScreen('Home: your groups', /Your groups/);
  if (/Couldn't load/.test(await bodyText())) throw new Error("Home: shows a \"Couldn't load\" message instead of the schedule");
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
  await expectScreen('Home → the Group', /Coming up/);
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
  if (/Couldn't load/.test(await bodyText())) throw new Error("Groups tab: shows a \"Couldn't load\" message");
  // Other tab screens stay mounted (hidden): pick the card that's on screen.
  const cards = await page.getByRole('button', { name: new RegExp(`^E2E Group ${stamp}`) }).all();
  let card = null;
  for (const c of cards) if (await c.isVisible()) card = c;
  if (!card) throw new Error('Groups tab: the new Group card is not on screen');
  await card.click();
  await expectScreen('Groups → the Group', /Coming up/);
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
