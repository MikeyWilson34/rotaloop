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
    expect(item.body).toBe(
      "Ben can't make Sound on Sun, Nov 29 at 9:00 AM: “Traveling”. The first to tap \"I'll cover\" takes it. · Sunday Team",
    );
    expect(item.url).toBe('/assignment/g1/a3?action=cover');
    expect(item.dedupeKey).toBe(`cmd:g1:v${t.version}:0:a3:coverageRequest:${ACCOUNT.ana}`);
  });

  it('goes to every Member, not only the job’s rotation, but never to someone with another job that day', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    // Cal greets on Nov 29: still not asked, as the app doesn't offer them "I'll cover".
    expect(who(plan(t))).toEqual([`${ACCOUNT.ana}:coverageRequest`]);
    // Ben declines his Dec 6 Greeter turn: Ana isn't in the Greeter rotation, but is asked too.
    t.run({ type: 'decline', assignmentId: t.seat('2026-12-06', 'greeter').id }, 'ben');
    expect(who(plan(t))).toContain(`${ACCOUNT.ana}:coverageRequest`);
  });

  it('respects the "Coverage Requests" toggle and push being off', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(who(plan(t, profiles({ ana: { notifyCoverageRequests: false }, cal: { pushEnabled: false } })))).toEqual([]);
  });

  it('is not sent to the actor when someone says a Stand-in can’t make it', () => {
    const t = new TestGroup();
    // Pat (a Stand-in) is Greeter on Nov 22; Ana says Pat can't make it.
    t.run({ type: 'decline', assignmentId: 'a2' }, 'ana');
    const items = plan(t);
    expect(who(items)).toEqual([`${ACCOUNT.ben}:coverageRequest`, `${ACCOUNT.cal}:coverageRequest`]);
    expect(items[0].body).toContain("Pat can't make Greeter on Sun, Nov 22 at 9:00 AM.");
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
  it('"I’ll cover" tells whoever couldn’t make it the swap, in plain words; not the coverer', () => {
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
    expect(covered.body).toBe("Ana's covering for you on Nov 29. You'll take Ana's next turn on Dec 13. · Sunday Team");
    // The swapped Sound turn (Dec 13) is in that sentence, so it isn't also a "schedule change".
    expect(items.some((i) => i.title === 'Schedule change: Sound, Sun, Dec 13')).toBe(false);
    expect(JSON.stringify(all)).not.toMatch(/Make-up Turn/);

    // Batched with anything else Ben hears, the cover comes first.
    const [message] = composeMessages(items);
    expect(message.body.split('\n')[0]).toBe(items.length > 1 ? 'Sound, Sun, Nov 29 is covered' : covered.body);
  });

  it('"Pick who’s covering" by anyone tells both sides; nobody is asked to confirm', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { memberId: 'cal' } }, 'ana');
    const items = plan(t);
    expect(who(items)).toContain(`${ACCOUNT.ben}:covered`);
    const ask = items.find((i) => i.kind === 'askedToConfirmCover')!;
    expect(ask.accountId).toBe(ACCOUNT.cal);
    expect(ask.title).toBe("You're covering Sound, Sun, Nov 29");
    expect(ask.body).toBe("You're covering Ben's Sound turn on Nov 29. Ben takes your next turn on Dec 6. · Sunday Team");
    expect(items.find((i) => i.kind === 'covered')!.body).toBe(
      "Cal's covering for you on Nov 29. You'll take Cal's next turn on Dec 6. · Sunday Team",
    );
    expect(ask.url).toBe('/assignment/g1/a3');
    expect(items.some((i) => i.accountId === ACCOUNT.ana)).toBe(false);
  });

  it('the person who couldn’t make it naming the cover only tells the coverer', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const late = '2026-11-27T12:00:00.000Z';
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { memberId: 'cal' } }, 'ben', late);
    expect(who(plan(t, profiles(), late)).filter((k) => !k.endsWith('scheduleChange'))).toEqual([
      `${ACCOUNT.cal}:askedToConfirmCover`,
    ]);
  });

  it('an outside cover reaches no one outside; the person who couldn’t make it hears it with no swap', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'markCovered', assignmentId: 'a3', by: { guestName: 'Sam' } }, 'ana');
    const items = plan(t);
    expect(who(items)).toEqual([`${ACCOUNT.ben}:covered`]);
    expect(items[0].body).toBe("Sam's covering for you on Nov 29. · Sunday Team");
  });

  it('"I’ll find someone to cover" in one step tells the coverer the swap', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3', coveredBy: { memberId: 'ana' } }, 'ben');
    const items = plan(t);
    const ask = items.find((i) => i.kind === 'askedToConfirmCover')!;
    expect(ask.accountId).toBe(ACCOUNT.ana);
    expect(ask.body).toBe("You're covering Ben's Sound turn on Nov 29. Ben takes your next turn on Dec 13. · Sunday Team");
    expect(items.some((i) => i.accountId === ACCOUNT.ben)).toBe(false);
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
