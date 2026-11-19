import { describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { buildGroup, NOW, run, seat, ZONE, type Built } from '../../schedule/tests/fixture';
import {
  attentionItems,
  greeting,
  groupCards,
  homeWeek,
  HOME_DAYS,
  inHomeWindow,
  todayLabel,
  type HomeContext,
  type HomeGroup,
} from '../home';

// The fixture: weekly Sundays from Nov 22, 2026. Sound (Ana, Ben, Cal in turn) and Greeter
// (Pat, Cal, Ben). NOW is Wednesday Nov 18, so the 7-day window is Nov 18–25.
const ctx: HomeContext = { now: NOW, viewerTimeZone: ZONE };
/** Monday Nov 23, 6:00 AM Chicago: the window is Nov 23–30. */
const MON: HomeContext = { ...ctx, now: '2026-11-23T12:00:00.000Z' };

function home(built: Built, me: string | null = 'ana', overrides: Partial<HomeGroup> = {}): HomeGroup {
  return {
    id: built.state.groupId,
    name: 'Sunday Team',
    timeZone: ZONE,
    state: built.state,
    myMemberId: me,
    history: built.history,
    ...overrides,
  };
}

/** Another Group (same schedule, other id and name). */
function other(built: Built, me = 'ana', name = 'Hospitality'): HomeGroup {
  const state: GroupState = { ...built.state, groupId: 'g2' };
  return home({ state, history: built.history }, me, { id: 'g2', name, state });
}

describe('header', () => {
  it('greets by the viewer’s clock and shows today', () => {
    expect(greeting('Alex Rivera', ctx)).toBe('Good morning, Alex');
    expect(greeting('Alex', { ...ctx, now: '2026-11-18T19:00:00.000Z' })).toBe('Good afternoon, Alex');
    expect(greeting(null, { ...ctx, now: '2026-11-19T01:00:00.000Z' })).toBe('Good evening');
    expect(todayLabel(ctx)).toBe('Wednesday, November 18');
  });
});

describe('the 7-day window', () => {
  it('runs from today through 7 days ahead', () => {
    expect(HOME_DAYS).toBe(7);
    expect(inHomeWindow('2026-11-18', '2026-11-18')).toBe(true);
    expect(inHomeWindow('2026-11-25', '2026-11-18')).toBe(true);
    expect(inHomeWindow('2026-11-26', '2026-11-18')).toBe(false);
    expect(inHomeWindow('2026-11-17', '2026-11-18')).toBe(false);
    // Across the year boundary.
    expect(inHomeWindow('2027-01-03', '2026-12-28')).toBe(true);
  });

  it('the big card is my first turn this week, with day, time and how soon', () => {
    const week = homeWeek([home(buildGroup())], ctx);
    expect(week.hero).toMatchObject({
      responsibilityName: 'Sound',
      groupName: 'Sunday Team',
      date: '2026-11-22',
      dayLabel: 'Sun, Nov 22',
      timeLabel: '9:00 AM',
      relative: 'In 4 days',
      mode: 'cantMakeIt',
      note: null,
      needsCover: false,
    });
    expect(week.thisWeek).toEqual([]);
    expect(week.needsYou).toEqual([]);
  });

  it('a turn exactly 7 days away is in; 8 days away is out', () => {
    const b = buildGroup();
    // Sunday Nov 15: Nov 22 is 7 days ahead.
    expect(homeWeek([home(b)], { ...ctx, now: '2026-11-15T18:00:00.000Z' }).hero?.date).toBe('2026-11-22');
    // Saturday Nov 14: 8 days ahead, so nothing this week.
    const early = homeWeek([home(b)], { ...ctx, now: '2026-11-14T18:00:00.000Z' });
    expect(early.hero).toBeNull();
    expect(early.nextTurn).toBe('Sound · Sunday Team · Sun, Nov 22');
  });

  it('the rest of my week is listed under the big card, soonest first; later turns are left out', () => {
    const b = buildGroup();
    const week = homeWeek([home(b), other(b)], ctx);
    // Same date in two Groups: by Group name.
    expect(week.hero?.groupName).toBe('Hospitality');
    expect(week.thisWeek.map((t) => [t.groupName, t.responsibilityName, t.dayLabel])).toEqual([['Sunday Team', 'Sound', 'Sun, Nov 22']]);
    // Ana's next Sound turns (Dec 13 on) are beyond the window.
    expect(week.thisWeek.every((t) => inHomeWindow(t.date, '2026-11-18'))).toBe(true);
  });

  it('a turn that already started is gone', () => {
    const b = buildGroup();
    expect(homeWeek([home(b)], { ...ctx, now: '2026-11-22T15:30:00.000Z' }).hero).toBeNull();
  });
});

describe('nothing this week', () => {
  it('names my next turn (job · group · date)', () => {
    // Cal's first turn is Greeter on Nov 29: outside Nov 18–25.
    const week = homeWeek([home(buildGroup(), 'cal')], ctx);
    expect(week.hero).toBeNull();
    expect(week.thisWeek).toEqual([]);
    expect(week.needsYou).toEqual([]);
    expect(week.nextTurn).toBe('Greeter · Sunday Team · Sun, Nov 29');
  });

  it('no turns coming up at all', () => {
    const b = buildGroup();
    expect(homeWeek([], ctx)).toEqual({ hero: null, needsYou: [], allSet: false, thisWeek: [], nextTurn: null });
    expect(homeWeek([home(b, null)], ctx).nextTurn).toBeNull();
    expect(homeWeek([home(b)], { ...ctx, now: '2027-01-11T00:00:00.000Z' }).nextTurn).toBeNull();
  });
});

describe('the big card', () => {
  it('my own open request: "Needs cover", and it is not repeated in Needs you', () => {
    const b = buildGroup();
    run(b, { type: 'decline', assignmentId: seat(b.state, '2026-11-22', 'sound').id }, 'ana');
    const week = homeWeek([home(b)], ctx);
    expect(week.hero?.mode).toBe('needsCover');
    expect(week.hero?.needsCover).toBe(true);
    expect(week.hero?.note).toEqual({ tone: 'warn', strong: 'Needs cover.', text: "We'll tell you when someone takes it." });
    expect(week.needsYou).toEqual([]);
    // "Nothing this week" would name a turn I'm actually serving, not the one I asked cover for.
    expect(week.nextTurn).toBe('Sound · Sunday Team · Sun, Dec 13');
  });

  it('covering someone: a thank-you line', () => {
    const b = buildGroup();
    const bens = seat(b.state, '2026-11-29', 'sound');
    run(b, { type: 'decline', assignmentId: bens.id }, 'ben');
    run(b, { type: 'cover', assignmentId: bens.id }, 'ana');
    const hero = homeWeek([home(b)], MON).hero!;
    expect(hero.assignmentId).toBe(bens.id);
    expect(hero.covering).toBe(true);
    expect(hero.mode).toBe('cantMakeIt');
    expect(hero.note).toEqual({ tone: 'ok', text: "You're covering for Ben. Thank you!" });
  });

  it('a swapped turn says who covered me and when', () => {
    const b = buildGroup();
    const anas = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: anas.id }, 'ana');
    run(b, { type: 'cover', assignmentId: anas.id }, 'ben');
    const hero = homeWeek([home(b)], MON).hero!;
    expect(hero.date).toBe('2026-11-29');
    expect(hero.note?.text).toBe("Ben covered you on Nov 22, so you're taking Ben's turn.");
  });

  it('a Job that still asks for confirmation: Confirm mode', () => {
    const b = buildGroup();
    run(b, { type: 'requestConfirmation', assignmentIds: [seat(b.state, '2026-11-22', 'sound').id] }, 'ana');
    expect(homeWeek([home(b)], ctx).hero?.mode).toBe('confirm');
  });
});

describe('Needs you', () => {
  it('someone’s request I can take, this week only', () => {
    const b = buildGroup();
    // Pat (not on the app) can't make Greeter on Nov 22; Ana declines for them.
    run(b, { type: 'decline', assignmentId: seat(b.state, '2026-11-22', 'greeter').id }, 'ana');
    const week = homeWeek([home(b, 'ben')], ctx);
    expect(week.needsYou.map((i) => [i.kind, i.title, i.sub, i.actions.map((a) => a.label)])).toEqual([
      ['cover', "Pat can't make it", 'Greeter · Sun, Nov 22 · Sunday Team', ["I'll cover", 'Details']],
    ]);
    // Ben's own next turn (Sound, Nov 29) is outside the window.
    expect(week.hero).toBeNull();

    // A request beyond the window is left out until it comes within 7 days.
    const c = buildGroup();
    run(c, { type: 'decline', assignmentId: seat(c.state, '2026-11-29', 'sound').id }, 'ben');
    expect(homeWeek([home(c, 'ana')], ctx).needsYou).toEqual([]);
    expect(homeWeek([home(c, 'ana')], MON).needsYou.map((i) => i.title)).toEqual(["Ben can't make it"]);
    // All dates are still available to other callers.
    expect(attentionItems([home(c, 'ana')], ctx).map((i) => i.kind)).toEqual(['cover']);
  });

  it('a turn waiting on me shows once: in Needs you, not again in This week', () => {
    const b = buildGroup();
    const sound22 = seat(b.state, '2026-11-22', 'sound').id;
    run(b, { type: 'requestConfirmation', assignmentIds: [sound22] }, 'ana');
    const week = homeWeek([home(b), other(b)], ctx);
    expect(week.hero?.groupName).toBe('Hospitality');
    expect(week.needsYou.map((i) => [i.kind, i.groupName])).toEqual([['confirm', 'Sunday Team']]);
    expect(week.thisWeek).toEqual([]);
  });
});

describe('Your groups', () => {
  it('one card per group, by name, with my next turn there', () => {
    const b = buildGroup();
    expect(groupCards([home(b), other(b, 'cal')], ctx)).toEqual([
      { groupId: 'g2', name: 'Hospitality', line: 'Your next turn: Greeter · Sun, Nov 29' },
      { groupId: 'g1', name: 'Sunday Team', line: 'Your next turn: Sound · Sun, Nov 22' },
    ]);
    expect(groupCards([home(b, null)], ctx)[0].line).toBe('No turns coming up');
    expect(groupCards([home(b)], { ...ctx, now: '2027-01-11T00:00:00.000Z' })[0].line).toBe('No turns coming up');
  });
});
