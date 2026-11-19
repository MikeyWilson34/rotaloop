/**
 * Simplify ticket 09 in the views: Home's "Coming?" card and list, the group page's headcount
 * rows, editing a job's type, the shared counts, and the "Coming?" reminder.
 */
import { describe, expect, it } from 'vitest';

import { comingUp, jobEditCommands, jobViews, newJobCommands } from '../../lib/groupPage';
import { newJobDraft } from '../../lib/groupCreate';
import { planScheduledNotifications } from '../../notify/plan';
import { profiles } from '../../notify/tests/helpers';
import { headcountCounts, headcountText, nextHeadcounts, upcomingHeadcounts } from '../../schedule/headcount';
import { buildGroup, eventId, NOW, run, ZONE, type Built } from '../../schedule/tests/fixture';
import { homeWeek, type HomeContext, type HomeGroup } from '../home';

const ctx: HomeContext = { now: NOW, viewerTimeZone: ZONE };

/** The schedule fixture (Sound, Greeter every Sunday from Nov 22) plus Coffee, a headcount, every Sunday. */
function withCoffee(): Built {
  const built = buildGroup();
  run(built, {
    type: 'addResponsibility',
    responsibility: { id: 'coffee', name: 'Coffee', kind: 'headcount', headcount: 1, requiresConfirmation: false },
    qualifiedMemberIds: ['ana', 'ben', 'cal', 'pat'],
  }, 'ana');
  run(built, { type: 'editEventSeries', seriesId: 'sun', changes: { responsibilityIds: ['sound', 'greeter', 'coffee'] } }, 'ana');
  return built;
}

const coffee = (date: string, memberId: string, answer: 'yes' | 'no') =>
  ({ type: 'answerHeadcount', eventId: eventId(date), responsibilityId: 'coffee', memberId, answer }) as const;

function home(built: Built, me = 'ana'): HomeGroup {
  return { id: 'g1', name: 'Sunday Team', timeZone: ZONE, state: built.state, myMemberId: me, history: built.history };
}

describe('headcount counts', () => {
  it('counts the Group’s current Members: coming, not, no reply', () => {
    const built = withCoffee();
    run(built, coffee('2026-11-22', 'ana', 'yes'), 'ana');
    run(built, coffee('2026-11-22', 'pat', 'no'), 'ben');
    const counts = headcountCounts(built.state, eventId('2026-11-22'), 'coffee');
    expect(counts).toEqual({ coming: 1, notComing: 1, noReply: 2 });
    expect(headcountText(counts)).toBe('1 coming · 1 not · 2 no reply');
    // Someone who left no longer counts.
    run(built, { type: 'removeMember', memberId: 'pat' }, 'ana');
    expect(headcountCounts(built.state, eventId('2026-11-22'), 'coffee')).toEqual({ coming: 1, notComing: 0, noReply: 2 });
  });

  it('lists upcoming dates, and the next one per Job', () => {
    const state = withCoffee().state;
    expect(upcomingHeadcounts(state, NOW).map((d) => d.eventId).slice(0, 2)).toEqual([eventId('2026-11-22'), eventId('2026-11-29')]);
    expect(nextHeadcounts(state, NOW)).toEqual([
      { eventId: eventId('2026-11-22'), responsibilityId: 'coffee', jobName: 'Coffee', startsAt: '2026-11-22T15:00:00.000Z' },
    ]);
  });
});

describe('Home', () => {
  it('keeps a turn on the big card; the same day’s headcount follows in "This week"', () => {
    // Nov 22: Ana has Sound, and Coffee is that morning too.
    const week = homeWeek([home(withCoffee(), 'ana')], ctx);
    expect(week.hero).toMatchObject({ responsibilityName: 'Sound' });
    expect(week.hero?.mode).not.toBe('headcount');
    expect(week.thisWeek).toEqual([
      expect.objectContaining({
        responsibilityName: 'Coffee',
        headcount: expect.objectContaining({ answer: null, counts: { coming: 0, notComing: 0, noReply: 4 } }),
      }),
    ]);
  });

  it('puts an answered headcount in "This week" and the next unanswered one on the card', () => {
    const built = withCoffee();
    // Someone with no turn this week: Pat (a Stand-in) can't use the app, so use a fresh Member.
    run(built, { type: 'addMember', member: { id: 'dee', name: 'Dee', accountId: 'acct-dee' } }, null);
    const before = homeWeek([home(built, 'dee')], ctx);
    expect(before.hero).toMatchObject({ mode: 'headcount', responsibilityName: 'Coffee', assignmentId: '' });
    expect(before.hero?.headcount?.eventId).toBe(eventId('2026-11-22'));

    run(built, coffee('2026-11-22', 'dee', 'yes'), 'dee');
    const after = homeWeek([home(built, 'dee')], ctx);
    expect(after.hero).toBeNull();
    expect(after.allSet).toBe(true);
    expect(after.thisWeek).toEqual([
      expect.objectContaining({ responsibilityName: 'Coffee', headcount: expect.objectContaining({ answer: 'yes', summary: '1 coming · 0 not · 4 no reply' }) }),
    ]);
  });
});

describe('group page', () => {
  it('shows each headcount date with its counts and my answer, after the turns', () => {
    const built = withCoffee();
    run(built, coffee('2026-11-22', 'ana', 'no'), 'ana');
    const days = comingUp({ id: 'g1', name: 'Sunday Team', timeZone: ZONE, state: built.state, myMemberId: 'ana' }, NOW, ZONE);
    const first = days[0];
    if (first.kind !== 'turns') throw new Error('expected turns');
    expect(first.rows.map((r) => [r.jobName, r.headcount?.summary ?? null, r.headcount?.answer ?? null])).toEqual([
      ['Sound', null, null],
      ['Greeter', null, null],
      ['Coffee', '0 coming · 1 not · 3 no reply', 'no'],
    ]);
  });

  it('adds a headcount job with no turns, and switching a job’s type sends the kind', () => {
    const built = withCoffee();
    const draft = { ...newJobDraft('2026-11-18'), name: 'Potluck', type: 'headcount' as const };
    const [add] = newJobCommands(built.state, draft, ZONE, new Date(NOW));
    expect(add).toMatchObject({ type: 'addResponsibility', responsibility: { name: 'Potluck', kind: 'headcount' } });
    expect(add).not.toHaveProperty('qualifiedMemberIds');

    const job = jobViews(built.state, ZONE, new Date(NOW)).find((j) => j.name === 'Coffee')!;
    expect(job.draft.type).toBe('headcount');
    const commands = jobEditCommands(built.state, job, { ...job.draft, type: 'turns' }, ZONE, new Date(NOW));
    expect(commands).toEqual([{ type: 'editResponsibility', responsibilityId: 'coffee', changes: { kind: 'turns' } }]);
  });
});

describe('"Coming?" reminder', () => {
  // Default profiles: 1 day before at 6:00 PM. Nov 22 9:00 AM Chicago → Sat Nov 21 6 PM = Nov 22 00:00Z.
  const due = '2026-11-22T00:05:00.000Z';

  it('asks those who haven’t answered, reminds those coming, and skips those not coming', () => {
    const built = withCoffee();
    run(built, coffee('2026-11-22', 'ben', 'yes'), 'ben');
    run(built, coffee('2026-11-22', 'cal', 'no'), 'cal');
    const items = planScheduledNotifications({ groups: [{ id: 'g1', name: 'Sunday Team', state: built.state }], profiles: profiles(), now: due })
      .filter((i) => i.eventId === eventId('2026-11-22') && i.assignmentId === null);
    expect(items.map((i) => [i.accountId, i.title, i.url])).toEqual([
      ['acct-ana', 'Coming? Coffee, Sun, Nov 22', '/'],
      ['acct-ben', 'Tomorrow: Coffee', '/'],
    ]);
    expect(items[0].body).toBe('Coffee on Sun, Nov 22 at 9:00 AM. Tap to answer Yes or No. · Sunday Team');
    expect(new Set(items.map((i) => i.dedupeKey)).size).toBe(2);
  });
});
