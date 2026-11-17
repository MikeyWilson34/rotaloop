import { describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { buildGroup, eventId, NOW, run, seat, ZONE, type Built } from '../../schedule/tests/fixture';
import {
  attentionItems,
  filterGroupCards,
  greeting,
  groupCards,
  groupFilterCounts,
  groupHealth,
  initialsOf,
  isRoutineHistory,
  parseGroupFilter,
  selectHero,
  showGroupFilters,
  skipDatesLabel,
  todayLabel,
  withLabel,
  type HomeContext,
  type HomeGroup,
} from '../home';

const ctx: HomeContext = { now: NOW, viewerTimeZone: ZONE };
/** Friday Nov 20, 2026, 6:00 AM Chicago: inside the 3-day "find a replacement by" window for Nov 22. */
const LATE = '2026-11-20T12:00:00.000Z';

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

/** Another Group (same shape, other id and name). */
function other(built: Built, me = 'ana', name = 'Hospitality'): HomeGroup {
  const state: GroupState = { ...built.state, groupId: 'g2' };
  return home({ state, history: built.history }, me, { id: 'g2', name, state });
}

const holderOf = (built: Built, date: string, r: string) => seat(built.state, date, r).memberId!;

describe('greeting', () => {
  it('says good morning / afternoon / evening by the viewer’s clock, with the first name', () => {
    expect(greeting('Alex Rivera', ctx)).toBe('Good morning, Alex');
    expect(greeting('Alex', { ...ctx, now: '2026-11-18T19:00:00.000Z' })).toBe('Good afternoon, Alex');
    expect(greeting('Alex', { ...ctx, now: '2026-11-19T01:00:00.000Z' })).toBe('Good evening, Alex');
    expect(greeting('', ctx)).toBe('Good morning');
    expect(greeting(null, ctx)).toBe('Good morning');
  });

  it('today’s date and initials', () => {
    expect(todayLabel(ctx)).toBe('Wednesday, November 18');
    expect(initialsOf('Alex Rivera')).toBe('AR');
    expect(initialsOf('ben')).toBe('B');
    expect(initialsOf('Mary Ann Lee')).toBe('ML');
    expect(initialsOf('  ')).toBe('?');
  });

  it('"With …" lists two names then a count', () => {
    expect(withLabel([])).toBeNull();
    expect(withLabel(['Ben'])).toBe('With Ben');
    expect(withLabel(['Ben', 'Cal'])).toBe('With Ben, Cal');
    expect(withLabel(['Ben', 'Cal', 'Dee', 'Eve'])).toBe('With Ben, Cal & 2 more');
  });
});

describe('selectHero', () => {
  it('is null with no Groups, or nothing upcoming for me', () => {
    expect(selectHero([], ctx)).toBeNull();
    const b = buildGroup();
    expect(selectHero([home(b, null)], ctx)).toBeNull();
    // After the last Event has started.
    expect(selectHero([home(b)], { ...ctx, now: '2027-01-11T00:00:00.000Z' })).toBeNull();
  });

  it('picks my soonest Assignment across Groups, with date, time, relative day and who’s with me', () => {
    const b = buildGroup();
    const anaFirst = b.state.assignments
      .filter((a) => a.memberId === 'ana')
      .map((a) => b.state.events.find((e) => e.id === a.eventId)!.startsAt)
      .sort()[0];
    const hero = selectHero([other(b, 'ben', 'Zeta'), home(b)], ctx)!;
    expect(hero).not.toBeNull();
    expect(Date.parse(anaFirst)).toBeLessThanOrEqual(Date.parse(`${hero.date}T23:00:00Z`));
    expect(hero.timeLabel).toBe('9:00 AM');
    expect(hero.dateLabel).toMatch(/^Sunday, /);
    expect(hero.relative).toMatch(/^In \d+ days?$|^In 1 week$/);
    const event = b.state.events.find((e) => e.startsAt.startsWith(hero.date))!;
    const others = b.state.assignments.filter((a) => a.eventId === event.id && a.memberId !== 'ana');
    expect(hero.with.length).toBe(others.length);
  });

  it('skips Events that already started and my own open Coverage Requests', () => {
    const b = buildGroup();
    const first = selectHero([home(b)], ctx)!;
    run(b, { type: 'decline', assignmentId: first.assignmentId }, 'ana');
    const next = selectHero([home(b)], ctx)!;
    expect(next.assignmentId).not.toBe(first.assignmentId);
    expect(next.date > first.date).toBe(true);
    // Once the first Event has started, it's no longer "next".
    const b2 = buildGroup();
    const h = selectHero([home(b2)], ctx)!;
    const later = selectHero([home(b2)], { ...ctx, now: `${h.date}T15:30:00.000Z` })!;
    expect(later.date > h.date).toBe(true);
  });

  it('Pending: Confirm mode; Confirmed: all set; Scheduled and needs confirmation: nothing to do yet', () => {
    const b = buildGroup();
    const h = selectHero([home(b)], ctx)!;
    expect(h.responsibilityName).toBe('Sound');
    expect(h.mode).toBe('later');
    expect(h.doneText).toMatch(/^Nothing to do yet/);
    run(b, { type: 'requestConfirmation', assignmentIds: [h.assignmentId] }, 'ana');
    const pending = selectHero([home(b)], ctx)!;
    expect(pending.mode).toBe('confirm');
    expect(pending.status).toBe('pending');
    run(b, { type: 'confirm', assignmentId: h.assignmentId }, 'ana');
    const confirmed = selectHero([home(b)], ctx)!;
    expect(confirmed.mode).toBe('allSet');
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.doneText).toBe("You're all set. We'll remind you before the Event.");
    // Ticket 11: the person's real reminder settings.
    const withPrefs = selectHero([home(b)], { ...ctx, reminderText: "We'll remind you the day before at 6:00 PM." })!;
    expect(withPrefs.doneText).toBe("You're all set. We'll remind you the day before at 6:00 PM.");
  });

  it('A Responsibility without confirmation is all set', () => {
    // Cal's next turn is Greeter on Nov 29, with Ben on Sound.
    const hero = selectHero([home(buildGroup(), 'cal')], ctx)!;
    expect(hero.responsibilityName).toBe('Greeter');
    expect(hero.date).toBe('2026-11-29');
    expect(hero.mode).toBe('allSet');
    expect(hero.withLabel).toBe('With Ben');
    expect(hero.with).toEqual([{ name: 'Ben', initials: 'B' }]);
  });

  it('Covering: "You’re covering" pill', () => {
    const b = buildGroup();
    // Ben declines his next Sound turn and Cal covers it.
    // Ben declines Sound on Nov 29 and Ana covers it; Ana can't make her own Nov 22.
    const bens = seat(b.state, '2026-11-29', 'sound');
    run(b, { type: 'decline', assignmentId: bens.id }, 'ben');
    run(b, { type: 'cover', assignmentId: bens.id }, 'ana');
    run(b, { type: 'decline', assignmentId: seat(b.state, '2026-11-22', 'sound').id }, 'ana');
    const hero = selectHero([home(b)], ctx)!;
    expect(hero.assignmentId).toBe(bens.id);
    expect(hero.pillLabel).toBe("You're covering");
    expect(hero.status).toBe('covered');
    expect(hero.mode).toBe('allSet');
  });

  it('Make-up Turn note: who covered me and when', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'decline', assignmentId: anas.assignmentId }, 'ana');
    run(b, { type: 'cover', assignmentId: anas.assignmentId }, 'ben');
    const turn = b.state.makeUpTurns.find((t) => t.debtorId === 'ana')!;
    expect(turn).toBeDefined();
    const paying = b.state.assignments.find((a) => a.makeUpTurnId === turn.id)!;
    expect(paying.memberId).toBe('ana');
    const hero = selectHero([home(b)], ctx)!;
    expect(hero.assignmentId).toBe(paying.id);
    expect(hero.makeUpTurn).toBe(true);
    expect(hero.notes.join(' ')).toMatch(/^Make-up Turn: Ben covered you on Nov 22, so you're taking Ben's turn\.$/);
  });

  it('Moved note after a Skip Date', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'addSkipDate', eventId: eventId(anas.date) }, 'ben');
    const hero = selectHero([home(b)], ctx)!;
    expect(hero.assignmentId).toBe(anas.assignmentId);
    expect(hero.date).toBe('2026-11-29');
    expect(hero.notes[0]).toBe(
      'Moved from Sun, Nov 22 to Sun, Nov 29. Ben marked Sun, Nov 22 as a Skip Date. Turns move forward one Event.',
    );
  });
});

describe('attentionItems', () => {
  it('is empty when nothing waits on me', () => {
    const b = buildGroup();
    expect(attentionItems([home(b)], ctx)).toEqual([]);
    expect(attentionItems([], ctx)).toEqual([]);
  });

  it('a Coverage Request I’m Qualified for: "I can cover"', () => {
    const b = buildGroup();
    const bens = selectHero([home(b, 'ben')], ctx)!;
    run(b, { type: 'decline', assignmentId: bens.assignmentId }, 'ben');
    const items = attentionItems([home(b)], ctx);
    const cover = items.find((i) => i.kind === 'cover')!;
    expect(cover.title).toBe('Ben needs someone for Sound');
    expect(cover.sub).toMatch(/^Sunday Team · Sun, /);
    expect(cover.tone).toBe('bad');
    expect(cover.actions.map((a) => a.kind)).toEqual(['cover', 'details']);
    // Pat (a Placeholder, not Qualified for Sound) gets nothing.
    expect(attentionItems([home(b, 'pat')], ctx)).toEqual([]);
  });

  it('no "I can cover" at an Event where I already serve, unless the Group allows doubling', () => {
    const b = buildGroup();
    run(b, { type: 'qualifyMember', memberId: 'ana', responsibilityId: 'greeter' }, 'ana');
    const anas = selectHero([home(b)], ctx)!;
    const greeter = seat(b.state, anas.date, 'greeter');
    run(b, { type: 'decline', assignmentId: greeter.id }, greeter.memberId === 'pat' ? 'ana' : greeter.memberId);
    expect(attentionItems([home(b)], ctx).filter((i) => i.assignmentId === greeter.id)).toEqual([]);
    run(b, { type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    expect(attentionItems([home(b)], ctx).find((i) => i.assignmentId === greeter.id)?.kind).toBe('cover');
  });

  it('my own open request: "Finding cover", how many were asked, withdraw only when available', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'decline', assignmentId: anas.assignmentId }, 'ana');
    const [item] = attentionItems([home(b)], ctx);
    expect(item.kind).toBe('myRequest');
    expect(item.title).toBe('Finding cover for your Sound');
    expect(item.sub).toMatch(/· 2 people asked · nobody yet$/);
    expect(item.actions.map((a) => a.kind)).toEqual(['viewRequest']);
    expect(attentionItems([home(b)], ctx, { canWithdraw: true })[0].actions.map((a) => a.kind)).toEqual([
      'viewRequest',
      'withdraw',
    ]);
  });

  it('Replacement Duty: mine after the deadline (Assigned Member), or an Admin’s (Admins)', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'decline', assignmentId: anas.assignmentId }, 'ana');
    const late = { ...ctx, now: LATE };
    const [mine] = attentionItems([home(b)], late);
    expect(mine.kind).toBe('replacementDuty');
    expect(mine.title).toBe("Nobody's free for your Sound turn");
    expect(mine.actions.map((a) => a.kind)).toEqual(['markCovered', 'details']);
    // Ben (Qualified, not on duty) can still volunteer.
    expect(attentionItems([home(b, 'ben')], late).find((i) => i.assignmentId === anas.assignmentId)?.kind).toBe('cover');

    const c = buildGroup();
    run(c, { type: 'changeSettings', settings: { replacementDuty: 'admins' } }, 'ana');
    const bens = selectHero([home(c, 'ben')], ctx)!;
    run(c, { type: 'decline', assignmentId: bens.assignmentId }, 'ben');
    const admin = attentionItems([home(c)], { ...ctx, now: `${bens.date}T00:00:00.000Z` }).find(
      (i) => i.assignmentId === bens.assignmentId,
    )!;
    expect(admin.kind).toBe('replacementDuty');
    expect(admin.title).toBe("Nobody's free for Sound (Ben)");
    // Ben no longer holds it: he sees his own request.
    expect(attentionItems([home(c, 'ben')], { ...ctx, now: `${bens.date}T00:00:00.000Z` })[0].kind).toBe('myRequest');
  });

  it('pending confirmations other than the hero, with inline Confirm', () => {
    const b = buildGroup();
    const anaTurns = b.state.assignments.filter((a) => a.memberId === 'ana' && a.responsibilityId === 'sound').map((a) => a.id);
    run(b, { type: 'requestConfirmation', assignmentIds: anaTurns.slice(0, 2) }, 'ana');
    const hero = selectHero([home(b)], ctx)!;
    const items = attentionItems([home(b)], ctx, { heroKey: hero.key });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('confirm');
    expect(items[0].title).toBe('Confirm Sound for Sunday Team');
    expect(items[0].actions.map((a) => a.kind)).toEqual(['confirm', 'decline']);
    // Without a hero key both show.
    expect(attentionItems([home(b)], ctx)).toHaveLength(2);
  });

  it('a Make-up Turn to confirm', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'decline', assignmentId: anas.assignmentId }, 'ana');
    run(b, { type: 'cover', assignmentId: anas.assignmentId }, 'ben');
    const paying = b.state.assignments.find((a) => a.makeUpTurnId && a.memberId === 'ana')!;
    run(b, { type: 'requestConfirmation', assignmentIds: [paying.id] }, 'ana');
    const item = attentionItems([home(b)], ctx).find((i) => i.assignmentId === paying.id)!;
    expect(item.kind).toBe('makeUp');
    expect(item.title).toBe('Confirm your Make-up Turn');
    expect(item.sub).toMatch(/Ben covered you on Nov 22, so you'll take Ben's Sound turn on Sun, /);
  });

  it('a moved Assignment awaiting confirmation', () => {
    const b = buildGroup();
    const anas = selectHero([home(b)], ctx)!;
    run(b, { type: 'requestConfirmation', assignmentIds: [anas.assignmentId] }, 'ana');
    run(b, { type: 'addSkipDate', eventId: eventId(anas.date) }, 'ben');
    // Every turn the Skip Date moved asks for confirmation again. The first is the hero (its
    // Confirm is there), so it shows here only without the hero key.
    const heroKey = selectHero([home(b)], ctx)!.key;
    const withHero = attentionItems([home(b)], ctx, { heroKey });
    expect(withHero.length).toBeGreaterThan(0);
    expect(withHero.every((i) => i.kind === 'moved' && i.key !== heroKey)).toBe(true);
    const [item] = attentionItems([home(b)], ctx);
    expect(item.kind).toBe('moved');
    expect(item.title).toBe('Your Sound turn moved');
    expect(item.sub).toBe(
      'Sunday Team · Moved from Sun, Nov 22 to Sun, Nov 29. Ben marked Sun, Nov 22 as a Skip Date. Turns move forward one Event. Please confirm again.',
    );
  });

  it('sorted by Event date, then the most urgent kind first', () => {
    const b = buildGroup();
    const anaTurns = b.state.assignments.filter((a) => a.memberId === 'ana').map((a) => a.id);
    run(b, { type: 'requestConfirmation', assignmentIds: anaTurns }, 'ana');
    const bens = selectHero([home(b, 'ben')], ctx)!;
    run(b, { type: 'decline', assignmentId: bens.assignmentId }, 'ben');
    const items = attentionItems([home(b), other(b)], ctx);
    for (let i = 1; i < items.length; i++) expect(Date.parse(items[i - 1].startsAt)).toBeLessThanOrEqual(Date.parse(items[i].startsAt));
    expect(new Set(items.map((i) => `${i.groupId}/${i.assignmentId}`)).size).toBe(items.length);
    const sameDay = items.filter((i) => i.date === items.find((x) => x.kind === 'cover')!.date);
    expect(sameDay.findIndex((i) => i.kind === 'cover')).toBe(0);
  });
});

describe('groupHealth', () => {
  it('counts open coverage (and those finding a replacement), pending in 3 weeks, recent changes and Skip Dates', () => {
    const b = buildGroup();
    // Pending: one within 3 weeks (Nov 22) and one beyond (Dec 20: more than 21 days after Nov 18).
    const soon = seat(b.state, '2026-11-22', 'sound');
    const far = seat(b.state, '2026-12-20', 'sound');
    run(b, { type: 'requestConfirmation', assignmentIds: [soon.id, far.id] }, 'ana');
    // Open coverage: one near (past the deadline at LATE), one later.
    const near = seat(b.state, '2026-11-22', 'greeter');
    const later = seat(b.state, '2026-12-06', 'sound');
    run(b, { type: 'decline', assignmentId: near.id }, near.memberId === 'pat' ? 'ana' : near.memberId);
    run(b, { type: 'decline', assignmentId: later.id }, later.memberId);
    run(b, { type: 'addSkipDate', eventId: eventId('2026-12-27') }, 'ben');

    const h = groupHealth(home(b), { ...ctx, now: LATE });
    expect(h.openCoverage).toBe(2);
    expect(h.findingReplacement).toBe(1);
    expect(h.pendingSoon).toBe(1);
    expect(h.skipDates).toEqual(['2026-12-27']);
    expect(h.needsAttention).toBe(true);
    expect(h.recentChanges).toBe(b.history.filter((e) => !isRoutineHistory(e)).length);
  });

  it('the 3-week window moves with now', () => {
    const b = buildGroup();
    const far = seat(b.state, '2026-12-06', 'sound');
    run(b, { type: 'requestConfirmation', assignmentIds: [far.id] }, 'ana');
    // Dec 6 15:00Z is 18 days after Nov 18: inside; from Nov 10 it is 26 days: outside.
    expect(groupHealth(home(b), ctx).pendingSoon).toBe(1);
    expect(groupHealth(home(b), { ...ctx, now: '2026-11-10T12:00:00.000Z' }).pendingSoon).toBe(0);
  });

  it('recent changes: the last 7 days only, routine entries left out', () => {
    const b = buildGroup();
    const day = 24 * 60 * 60 * 1000;
    const at = (n: number) => new Date(Date.parse(NOW) - n * day).toISOString();
    const g = home(b, 'ana', {
      history: [
        { id: '1', at: at(1), actorId: 'ben', cause: { type: 'addSkipDate', eventId: eventId('2026-12-27') }, changes: [], makeUpTurns: [] },
        { id: '2', at: at(6.9), actorId: 'ana', cause: { type: 'rebalance', responsibilityId: 'sound' }, changes: [], makeUpTurns: [] },
        { id: '3', at: at(7.1), actorId: 'ana', cause: { type: 'rebalance', responsibilityId: 'sound' }, changes: [], makeUpTurns: [] },
        { id: '4', at: at(0.5), actorId: null, cause: { type: 'addEvents', events: [] }, changes: [], makeUpTurns: [] },
        { id: '5', at: at(0.5), actorId: null, cause: { type: 'fillSchedule' }, changes: [], makeUpTurns: [] },
        { id: '6', at: at(0.5), actorId: 'ana', cause: { type: 'addEvents', events: [] }, changes: [], makeUpTurns: [] },
      ],
    });
    expect(groupHealth(g, ctx).recentChanges).toBe(3);
  });

  it('a calm Group needs no attention', () => {
    const h = groupHealth(home(buildGroup(), 'ana', { history: [] }), ctx);
    expect(h).toMatchObject({ openCoverage: 0, findingReplacement: 0, pendingSoon: 0, recentChanges: 0, skipDates: [], needsAttention: false });
  });

  it('Skip Date label', () => {
    expect(skipDatesLabel([])).toBe('No Skip Dates');
    expect(skipDatesLabel(['2026-11-26'])).toBe('Skip Nov 26');
    expect(skipDatesLabel(['2026-11-26', '2026-12-27', '2027-01-03'])).toBe('Skip Nov 26, Dec 27 +1');
  });
});

describe('groupCards and filters', () => {
  it('Member cards: next Event, the Primary Responsibility holder, my next turn; no health', () => {
    const b = buildGroup();
    run(b, { type: 'setPrimaryResponsibility', responsibilityId: 'sound' }, 'ana');
    const [card] = groupCards([home(b, 'ben')], ctx);
    const holder = b.state.members.find((m) => m.id === holderOf(b, '2026-11-22', 'sound'))!.name;
    expect(card.nextLine).toBe(`Sun, Nov 22 · Sound: ${holder}`);
    expect(card.isAdmin).toBe(false);
    expect(card.health).toBeNull();
    expect(card.myNext?.label).toMatch(/^You · (Nov|Dec) \d+$/);
  });

  it('no Primary Responsibility: just the date; no Events: says so; no turns: null', () => {
    const b = buildGroup();
    expect(groupCards([home(b)], ctx)[0].nextLine).toBe('Sun, Nov 22');
    expect(groupCards([home(b, 'pat')], { ...ctx, now: '2027-02-01T00:00:00.000Z' })[0]).toMatchObject({
      nextLine: 'No upcoming Events',
      myNext: null,
    });
  });

  it('Admin cards carry health; sorted by name', () => {
    const b = buildGroup();
    const cards = groupCards([other(b, 'ana', 'Zeta'), home(b)], ctx);
    expect(cards.map((c) => c.name)).toEqual(['Sunday Team', 'Zeta']);
    expect(cards[0].isAdmin).toBe(true);
    expect(cards[0].health).not.toBeNull();
  });

  it('filters: shown only to Admins; Managed by me; Needs attention (managed and with issues)', () => {
    const b = buildGroup();
    const asMember = groupCards([home(b, 'ben'), other(b, 'ben')], ctx);
    expect(showGroupFilters(asMember)).toBe(false);
    expect(parseGroupFilter('managed', asMember)).toBe('all');

    const calm = buildGroup();
    const busy = buildGroup();
    run(busy, { type: 'requestConfirmation', assignmentIds: [seat(busy.state, '2026-11-22', 'sound').id] }, 'ana');
    const cards = groupCards(
      [
        home(calm, 'ana', { id: 'calm', name: 'Calm' }),
        home(busy, 'ana', { id: 'busy', name: 'Busy' }),
        home(busy, 'ben', { id: 'member', name: 'Member only' }),
      ],
      ctx,
    );
    expect(showGroupFilters(cards)).toBe(true);
    expect(filterGroupCards(cards, 'all').map((c) => c.name)).toEqual(['Busy', 'Calm', 'Member only']);
    expect(filterGroupCards(cards, 'managed').map((c) => c.name)).toEqual(['Busy', 'Calm']);
    expect(filterGroupCards(cards, 'attention').map((c) => c.name)).toEqual(['Busy']);
    expect(groupFilterCounts(cards)).toEqual({ all: 3, managed: 2, attention: 1 });
    expect(parseGroupFilter('attention', cards)).toBe('attention');
    expect(parseGroupFilter('nonsense', cards)).toBe('all');
  });
});
