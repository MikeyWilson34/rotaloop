import { describe, expect, it } from 'vitest';

import { composeMessages, confirmationRequestsDue, planCommandNotifications, type NotificationItem } from '../plan';
import { ACCOUNT, NOW, profiles, TestGroup } from './helpers';

/** Fixture: Sound (needs confirmation) rotates ana → ben → cal; Greeter pat → cal → ben.
 * Nov 22: Sound ana, Greeter pat. Nov 29: Sound ben (a3), Greeter cal. Dec 6: Sound cal, Greeter ben. */

function plan(t: TestGroup, p = profiles(), now = NOW): NotificationItem[] {
  return planCommandNotifications({ group: t.group, history: t.last, stateVersion: t.version, profiles: p, now });
}

const who = (items: NotificationItem[]) => items.map((i) => `${i.accountId}:${i.kind}`).sort();

describe('a new Coverage Request', () => {
  it('goes to the Qualified Members free at that Event, never the decliner', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3', reason: 'Traveling' }, 'ben');
    const items = plan(t);
    // Cal is Qualified for Sound but already Greeter on Nov 29.
    expect(who(items)).toEqual([`${ACCOUNT.ana}:coverageRequest`]);
    const [item] = items;
    expect(item.title).toBe('Can you cover Sound, Sun, Nov 29?');
    expect(item.body).toBe("Ben can't make Sound on Sun, Nov 29: “Traveling”. Coverage requested. · Sunday Team");
    expect(item.url).toBe('/assignment/g1/a3?action=cover');
    expect(item.dedupeKey).toBe(`cmd:g1:v${t.version}:0:a3:coverageRequest:${ACCOUNT.ana}`);
  });

  it('includes Members serving elsewhere at the Event when the Group allows doubling', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(who(plan(t))).toEqual([`${ACCOUNT.ana}:coverageRequest`, `${ACCOUNT.cal}:coverageRequest`]);
  });

  it('respects the "Coverage Requests" toggle and push being off', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(who(plan(t, profiles({ ana: { notifyCoverageRequests: false }, cal: { pushEnabled: false } })))).toEqual([]);
  });

  it('is not sent to the actor when an Admin declines for a Placeholder', () => {
    const t = new TestGroup();
    // Pat (Placeholder) is Greeter on Nov 22; Ana (Admin) declines for Pat.
    t.run({ type: 'decline', assignmentId: 'a2' }, 'ana');
    const items = plan(t);
    expect(who(items)).toEqual([`${ACCOUNT.ben}:coverageRequest`, `${ACCOUNT.cal}:coverageRequest`]);
    expect(items[0].body).toContain("Ana said Pat can't make Greeter on Sun, Nov 22");
  });

  it('nothing is sent for Events that have started', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(plan(t, profiles(), '2026-11-29T16:00:00.000Z')).toEqual([]);
  });

  it('a withdrawn Decline announces nothing', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'withdrawDecline', assignmentId: 'a3' }, 'ben');
    expect(plan(t)).toEqual([]);
  });
});

describe('Covers', () => {
  it('a Cover tells the decliner, not the coverer; the Make-up Turn it creates is batched in', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'cover', assignmentId: 'a3' }, 'ana');
    const all = plan(t);
    expect(all.some((i) => i.accountId === ACCOUNT.ana)).toBe(false);
    // Ben rests on Dec 20 after his Make-up Turn, so others move up and hear about it too.
    expect(all.filter((i) => i.accountId !== ACCOUNT.ben).every((i) => i.kind === 'scheduleChange')).toBe(true);
    const items = all.filter((i) => i.accountId === ACCOUNT.ben);
    const covered = items.find((i) => i.kind === 'covered')!;
    expect(covered.title).toBe('Sound, Sun, Nov 29 is covered');
    expect(covered.body).toBe('Ana covered Sound on Sun, Nov 29 for you. · Sunday Team');
    // Pay It Back: Ben takes Ana's next Sound turn (Dec 13).
    const payBack = items.find((i) => i.kind === 'scheduleChange')!;
    expect(payBack.title).toBe('Schedule change: Sound, Sun, Dec 13');
    // Ben's own Dec 20 turn moves up to Dec 13: he serves once, then rests.
    expect(payBack.body).toContain('Moved from Sun, Dec 20 to Sun, Dec 13 (Make-up Turn)');

    const [message] = composeMessages(items);
    // Ben now serves Sound on Dec 13, so his Greeter dates shift too (no double booking).
    expect(message.title).toBe(`${items.length} updates · Sunday Team`);
    expect(message.body.split('\n').slice(0, 2)).toEqual([
      'Sound, Sun, Nov 29 is covered',
      'Schedule change: Sound, Sun, Dec 13',
    ]);
    expect(message.url).toBe('/');
  });

  it('"Mark covered" by an Admin tells the decliner and asks the coverer to confirm', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { memberId: 'cal' } }, 'ana');
    const items = plan(t);
    expect(who(items)).toContain(`${ACCOUNT.ben}:covered`);
    const ask = items.find((i) => i.kind === 'askedToConfirmCover')!;
    expect(ask.accountId).toBe(ACCOUNT.cal);
    expect(ask.title).toBe('Please confirm: Sound, Sun, Nov 29');
    expect(ask.body).toBe('Ana has you down to cover Sound on Sun, Nov 29 at 9:00 AM. Please confirm. · Sunday Team');
    expect(ask.url).toBe('/assignment/g1/a3');
    expect(items.some((i) => i.accountId === ACCOUNT.ana)).toBe(false);
  });

  it('the decliner marking it covered themselves (Replacement Duty) only tells the coverer', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const late = '2026-11-27T12:00:00.000Z';
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { memberId: 'cal' } }, 'ben', late);
    expect(who(plan(t, profiles(), late)).filter((k) => !k.endsWith('scheduleChange'))).toEqual([
      `${ACCOUNT.cal}:askedToConfirmCover`,
    ]);
  });

  it('a Guest Cover reaches no guest; the decliner hears only if someone else arranged it', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { guestName: 'Sam' } }, 'ana');
    const items = plan(t);
    expect(who(items)).toEqual([`${ACCOUNT.ben}:covered`]);
    expect(items[0].body).toBe('Ana marked Sound on Sun, Nov 29 covered by Sam (guest). · Sunday Team');
  });

  it('a withdrawn Cover reopens the request: the decliner and Qualified Members hear', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'cover', assignmentId: 'a3' }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ana');
    const kinds = who(plan(t));
    expect(kinds).toContain(`${ACCOUNT.ben}:coverWithdrawn`);
    expect(kinds.some((k) => k.startsWith(ACCOUNT.ana))).toBe(false);
  });
});

describe('schedule changes', () => {
  it('a Skip Date tells everyone whose turn moved, except the Member who added it', () => {
    const t = new TestGroup();
    t.run({ type: 'addSkipDate', eventId: 'sun@2026-11-22', reason: 'Holiday' }, 'cal');
    const items = plan(t);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === 'scheduleChange')).toBe(true);
    expect(items.some((i) => i.accountId === ACCOUNT.cal)).toBe(false);
    const anaFirst = items.find((i) => i.accountId === ACCOUNT.ana && i.assignmentId === 'a1')!;
    expect(anaFirst.title).toBe('Schedule change: Sound, Sun, Nov 29');
    expect(anaFirst.body).toBe(
      'Moved from Sun, Nov 22 to Sun, Nov 29. Cal marked Sun, Nov 22 as a Skip Date (Holiday). Turns move forward one Event. · Sunday Team',
    );
  });

  it('respects the "Schedule changes" toggle', () => {
    const t = new TestGroup();
    t.run({ type: 'addSkipDate', eventId: 'sun@2026-11-22' }, 'cal');
    const items = plan(t, profiles({ ben: { notifyChanges: false } }));
    expect(items.some((i) => i.accountId === ACCOUNT.ben)).toBe(false);
    expect(items.some((i) => i.accountId === ACCOUNT.ana)).toBe(true);
  });

  it('a Time Off swap tells the Member who takes the turn, not the one taking Time Off', () => {
    const t = new TestGroup();
    t.run(
      { type: 'addTimeOff', timeOff: { id: 'off1', memberId: 'ben', startsAt: '2026-11-29T06:00:00.000Z', endsAt: '2026-11-30T06:00:00.000Z' } },
      'ben',
    );
    const items = plan(t);
    expect(items.some((i) => i.accountId === ACCOUNT.ben)).toBe(false);
    const cal = items.filter((i) => i.accountId === ACCOUNT.cal);
    expect(cal.length).toBeGreaterThan(0);
    expect(cal.some((i) => i.body.includes('Ben added Time Off'))).toBe(true);
  });

  it('an Admin series edit tells the affected Members; Events it adds are not news', () => {
    const t = new TestGroup();
    t.run({ type: 'addEvents', events: [{ id: 'sun@2027-01-17', seriesId: 'sun', startsAt: '2027-01-17T15:00:00.000Z' }] }, 'ana');
    expect(plan(t)).toEqual([]);
  });

  it('Placeholders get nothing', () => {
    const t = new TestGroup();
    t.run({ type: 'addSkipDate', eventId: 'sun@2026-11-22' }, 'ana');
    // Pat (Placeholder) moved too, but has no account.
    expect(plan(t).every((i) => i.accountId !== undefined && i.accountId.startsWith('acct-'))).toBe(true);
  });
});

describe('confirmation requests', () => {
  it('asks to confirm Assignments within the window that need it', () => {
    const t = new TestGroup();
    // Nov 22 and Nov 29 are within 14 days of Wed Nov 18; Greeter needs no confirmation.
    expect(confirmationRequestsDue(t.state, NOW)).toEqual(['a1', 'a3']);
  });

  it('skips open requests and Skip Dates', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'addSkipDate', eventId: 'sun@2026-11-22' }, 'ana');
    // Ana's turn moved to Nov 29 (where Ben's Decline is pinned): only fresh seats count.
    const due = confirmationRequestsDue(t.state, NOW);
    expect(due).not.toContain('a3');
    expect(due.every((id) => t.state.assignments.find((a) => a.id === id)!.eventId !== 'sun@2026-11-22')).toBe(true);
  });

  it('the system request tells each Member (no actor to skip)', () => {
    const t = new TestGroup();
    t.run({ type: 'requestConfirmation', assignmentIds: ['a1', 'a3'] }, null);
    const items = plan(t);
    expect(who(items)).toEqual([`${ACCOUNT.ana}:confirmationRequested`, `${ACCOUNT.ben}:confirmationRequested`]);
    expect(items.find((i) => i.accountId === ACCOUNT.ben)!.body).toBe(
      'Can you still make Sound on Sun, Nov 29 at 9:00 AM? · Sunday Team',
    );
  });
});

describe('dedupe keys', () => {
  it('are stable for the same command and differ between commands', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const first = plan(t).map((i) => i.dedupeKey);
    expect(plan(t).map((i) => i.dedupeKey)).toEqual(first);
    t.run({ type: 'withdrawDecline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const again = plan(t).map((i) => i.dedupeKey);
    expect(again).not.toEqual(first);
    expect(new Set([...again, ...first]).size).toBe(again.length + first.length);
  });
});
