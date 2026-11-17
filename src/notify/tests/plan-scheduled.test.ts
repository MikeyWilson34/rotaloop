import { describe, expect, it } from 'vitest';

import { composeMessages, MAX_LINES, planScheduledNotifications, reminderDueAt, type NotificationItem } from '../plan';
import { ACCOUNT, NOW, plusMinutes, profiles, TestGroup } from './helpers';

/** Fixture Events: Sundays 9:00 AM Chicago (15:00Z). Nov 29: Sound ben (a3), Greeter cal (a4). */

function plan(t: TestGroup, now: string, p = profiles()): NotificationItem[] {
  return planScheduledNotifications({ groups: [t.group], profiles: p, now });
}

const who = (items: NotificationItem[]) => items.map((i) => `${i.accountId}:${i.kind}:${i.assignmentId}:${i.offsetKey}`).sort();

/** Ben's default reminder for Nov 29: Sat Nov 28, 6:00 PM Chicago = Nov 29 00:00Z. */
const BEN_REMINDER = '2026-11-29T00:00:00.000Z';

describe('reminderDueAt', () => {
  const chicago = { reminderTime: '18:00', timeZone: 'America/Chicago' };

  it('is the reminder time on the right day in the Member’s time zone', () => {
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 1, chicago)).toBe('2026-11-29T00:00:00.000Z');
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 7, chicago)).toBe('2026-11-23T00:00:00.000Z');
    // A Member in New York: 6:00 PM Eastern the day before.
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 1, { reminderTime: '18:00:00', timeZone: 'America/New_York' })).toBe(
      '2026-11-28T23:00:00.000Z',
    );
  });

  it('uses the Member’s own calendar day, not UTC’s', () => {
    // 7:00 PM Chicago on Sat Nov 28 is 01:00Z Sunday: "1 day before" is still Friday 6 PM local.
    expect(reminderDueAt('2026-11-29T01:00:00.000Z', 1, chicago)).toBe('2026-11-28T00:00:00.000Z');
  });

  it('stays at 6:00 PM local across the spring-forward change', () => {
    // US clocks spring forward Sun Mar 14, 2027. Event: 9:00 AM CDT Mar 14 = 14:00Z.
    expect(reminderDueAt('2027-03-14T14:00:00.000Z', 1, chicago)).toBe('2027-03-14T00:00:00.000Z'); // Sat 6 PM CST
    // Event Mar 21 (CDT): a week before is Mar 14 6 PM CDT = 23:00Z.
    expect(reminderDueAt('2027-03-21T14:00:00.000Z', 7, chicago)).toBe('2027-03-14T23:00:00.000Z');
    // Event Mar 15 (CDT): the day before, Mar 14 6 PM, is already CDT.
    expect(reminderDueAt('2027-03-15T14:00:00.000Z', 1, chicago)).toBe('2027-03-14T23:00:00.000Z');
  });

  it('stays at 8:00 AM local across the fall-back change (London)', () => {
    const london = { reminderTime: '08:00', timeZone: 'Europe/London' };
    // UK clocks fall back Sun Oct 31, 2027. Event: 10:00 AM GMT Oct 31 = 10:00Z.
    expect(reminderDueAt('2027-10-31T10:00:00.000Z', 1, london)).toBe('2027-10-30T07:00:00.000Z'); // Sat 8 AM BST
    expect(reminderDueAt('2027-10-31T10:00:00.000Z', 0, london)).toBe('2027-10-31T08:00:00.000Z'); // Sun 8 AM GMT
  });

  it('a reminder time skipped by spring-forward moves forward by the gap', () => {
    // 2:30 AM doesn't exist on Mar 14 in Chicago: it becomes 3:30 AM CDT (08:30Z).
    expect(reminderDueAt('2027-03-14T18:00:00.000Z', 0, { reminderTime: '02:30', timeZone: 'America/Chicago' })).toBe(
      '2027-03-14T08:30:00.000Z',
    );
  });

  it('"Morning of" uses the reminder time before noon, else 7:00 AM, and never after the Event starts', () => {
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 0, chicago)).toBe('2026-11-29T13:00:00.000Z'); // 7:00 AM CST
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 0, { ...chicago, reminderTime: '08:00' })).toBe('2026-11-29T14:00:00.000Z');
    expect(reminderDueAt('2026-11-29T12:30:00.000Z', 0, chicago)).toBeNull(); // a 6:30 AM Event
  });

  it('falls back to UTC for an unknown time zone', () => {
    expect(reminderDueAt('2026-11-29T15:00:00.000Z', 1, { reminderTime: '18:00', timeZone: 'Mars/Base' })).toBe(
      '2026-11-28T18:00:00.000Z',
    );
  });
});

describe('assignment reminders', () => {
  it('fire once due and within the grace period, not before or long after', () => {
    const t = new TestGroup();
    const ben = (now: string) => plan(t, now).filter((i) => i.kind === 'reminder' && i.accountId === ACCOUNT.ben);
    expect(ben(plusMinutes(BEN_REMINDER, -1))).toEqual([]);
    expect(ben(BEN_REMINDER).map((i) => i.assignmentId)).toEqual(['a3']);
    expect(ben(plusMinutes(BEN_REMINDER, 59)).map((i) => i.assignmentId)).toEqual(['a3']);
    expect(ben(plusMinutes(BEN_REMINDER, 61))).toEqual([]);
  });

  it('carries the copy, deep link and a dedupe key per Assignment, Event and offset', () => {
    const t = new TestGroup();
    const [item] = plan(t, BEN_REMINDER).filter((i) => i.accountId === ACCOUNT.ben);
    expect(item).toMatchObject({
      kind: 'reminder',
      title: 'Tomorrow: Sound',
      body: "You're on Sound on Sun, Nov 29 at 9:00 AM. · Sunday Team",
      url: '/assignment/g1/a3',
      offsetKey: '1d',
      dedupeKey: `reminder:g1:a3:sun@2026-11-29:1d:${ACCOUNT.ben}`,
    });
  });

  it('asks to confirm when confirmation was requested', () => {
    const t = new TestGroup();
    t.run({ type: 'requestConfirmation', assignmentIds: ['a3'] }, null);
    const [item] = plan(t, BEN_REMINDER).filter((i) => i.accountId === ACCOUNT.ben);
    expect(item.body).toBe("You're on Sound on Sun, Nov 29 at 9:00 AM. Please confirm. · Sunday Team");
  });

  it('one per chosen offset, at each offset’s own time', () => {
    const t = new TestGroup();
    const p = profiles({ ben: { reminderDaysBefore: [7, 1, 0] } });
    const at = (now: string) => plan(t, now, p).filter((i) => i.accountId === ACCOUNT.ben && i.assignmentId === 'a3').map((i) => i.offsetKey);
    expect(at('2026-11-23T00:00:00.000Z')).toEqual(['7d']);
    expect(at(BEN_REMINDER)).toEqual(['1d']);
    expect(at('2026-11-29T13:00:00.000Z')).toEqual(['0d']);
    const [week] = plan(t, '2026-11-23T00:00:00.000Z', p).filter((i) => i.accountId === ACCOUNT.ben);
    expect(week.title).toBe('In 1 week: Sound');
  });

  it('none when push is off or no reminders are chosen', () => {
    const t = new TestGroup();
    expect(plan(t, BEN_REMINDER, profiles({ ben: { pushEnabled: false } })).filter((i) => i.accountId === ACCOUNT.ben)).toEqual([]);
    expect(plan(t, BEN_REMINDER, profiles({ ben: { reminderDaysBefore: [] } })).filter((i) => i.accountId === ACCOUNT.ben)).toEqual([]);
  });

  it('none for a Placeholder, a Skip Date, or a seat the holder asked to have covered', () => {
    const t = new TestGroup();
    // Pat (Placeholder) is Greeter on Nov 22: no account, nothing planned.
    const nov22 = '2026-11-22T00:00:00.000Z';
    expect(plan(t, nov22).some((i) => i.assignmentId === 'a2')).toBe(false);
    expect(plan(t, nov22).some((i) => i.assignmentId === 'a1')).toBe(true);

    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(plan(t, BEN_REMINDER).some((i) => i.kind === 'reminder' && i.accountId === ACCOUNT.ben)).toBe(false);

    const s = new TestGroup();
    s.run({ type: 'addSkipDate', eventId: 'sun@2026-11-22' }, 'ana');
    expect(plan(s, nov22).some((i) => i.eventId === 'sun@2026-11-22')).toBe(false);
  });

  it('the coverer is reminded; a Guest Cover reminds no one', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'cover', assignmentId: 'a3' }, 'ana');
    const reminders = plan(t, BEN_REMINDER).filter((i) => i.kind === 'reminder' && i.assignmentId === 'a3');
    expect(reminders.map((i) => i.accountId)).toEqual([ACCOUNT.ana]);

    const g = new TestGroup();
    g.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    g.run({ type: 'markCovered', assignmentId: 'a3', by: { guestName: 'Sam' } }, 'ana');
    expect(plan(g, BEN_REMINDER).filter((i) => i.kind === 'reminder' && i.assignmentId === 'a3')).toEqual([]);
  });

  it('a moved Assignment gets a fresh reminder for its new Event', () => {
    const t = new TestGroup();
    const before = plan(t, BEN_REMINDER).find((i) => i.accountId === ACCOUNT.ben)!.dedupeKey;
    t.run({ type: 'addSkipDate', eventId: 'sun@2026-11-29' }, 'ana');
    const moved = t.state.assignments.find((a) => a.id === 'a3')!;
    expect(moved.eventId).toBe('sun@2026-12-06');
    const after = plan(t, '2026-12-06T00:00:00.000Z').find((i) => i.accountId === ACCOUNT.ben && i.assignmentId === 'a3')!;
    expect(after.dedupeKey).not.toBe(before);
  });

  it('a second run at the same time plans the same keys (the log makes it send once)', () => {
    const t = new TestGroup();
    expect(plan(t, BEN_REMINDER).map((i) => i.dedupeKey)).toEqual(plan(t, plusMinutes(BEN_REMINDER, 15)).map((i) => i.dedupeKey));
  });
});

describe('Coverage Request follow-up and Replacement Duty', () => {
  /** Nov 29's "find a replacement by" deadline (3 days before 15:00Z). */
  const DEADLINE = '2026-11-26T15:00:00.000Z';

  it('at the deadline: one follow-up to the Qualified Members, Replacement Duty to the decliner', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const now = plusMinutes(DEADLINE, 5);
    const items = plan(t, now).filter((i) => i.assignmentId === 'a3');
    expect(who(items)).toEqual([
      `${ACCOUNT.ana}:adminAlert:a3:needsCoverage`,
      `${ACCOUNT.ana}:coverageFollowUp:a3:deadline`,
      `${ACCOUNT.ben}:replacementDuty:a3:deadline`,
    ]);
    const follow = items.find((i) => i.kind === 'coverageFollowUp')!;
    expect(follow.title).toBe('Still needs cover: Sound, Sun, Nov 29');
    expect(follow.body).toBe("Ben's Sound on Sun, Nov 29 at 9:00 AM still needs someone. Can you cover? · Sunday Team");
    expect(follow.url).toBe('/assignment/g1/a3?action=cover');
    const duty = items.find((i) => i.kind === 'replacementDuty')!;
    expect(duty.url).toBe('/assignment/g1/a3?action=markCovered');
    expect(duty.body).toBe('No one has covered your turn yet. Please find someone and mark it covered. · Sunday Team');
  });

  it('nothing before the deadline; the follow-up respects the topic toggle', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    expect(plan(t, plusMinutes(DEADLINE, -1)).filter((i) => i.assignmentId === 'a3' && i.kind !== 'reminder')).toEqual([]);
    const off = plan(t, DEADLINE, profiles({ ana: { notifyCoverageRequests: false } }));
    expect(off.some((i) => i.kind === 'coverageFollowUp')).toBe(false);
  });

  it('a late job skips the follow-up but still sends Replacement Duty', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const kinds = plan(t, plusMinutes(DEADLINE, 120)).filter((i) => i.assignmentId === 'a3').map((i) => i.kind);
    expect(kinds).not.toContain('coverageFollowUp');
    expect(kinds).toContain('replacementDuty');
  });

  it('a Decline after the deadline: no follow-up and no duty notice to the decliner (they know)', () => {
    const t = new TestGroup();
    const late = plusMinutes(DEADLINE, 30);
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben', late);
    const kinds = who(plan(t, plusMinutes(late, 15)).filter((i) => i.assignmentId === 'a3'));
    expect(kinds).toEqual([`${ACCOUNT.ana}:adminAlert:a3:needsCoverage`]);
  });

  it('with Replacement Duty on Admins, the Admins hold it (and get no separate alert)', () => {
    const t = new TestGroup();
    t.run({ type: 'changeSettings', settings: { replacementDuty: 'admins' } }, 'ana');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    const items = plan(t, DEADLINE).filter((i) => i.assignmentId === 'a3');
    expect(who(items)).toEqual([`${ACCOUNT.ana}:coverageFollowUp:a3:deadline`, `${ACCOUNT.ana}:replacementDuty:a3:deadline`]);
    expect(items.find((i) => i.kind === 'replacementDuty')!.body).toBe(
      "No one has covered Ben's Sound on Sun, Nov 29 at 9:00 AM yet. As an Admin, please find someone and mark it covered. · Sunday Team",
    );
  });

  it("a Placeholder's request falls to the Admins", () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a2' }, 'ana'); // Pat's Greeter, Nov 22
    const items = plan(t, '2026-11-19T15:00:00.000Z').filter((i) => i.assignmentId === 'a2');
    expect(items.filter((i) => i.kind === 'replacementDuty').map((i) => i.accountId)).toEqual([ACCOUNT.ana]);
  });

  it('a covered request gets neither', () => {
    const t = new TestGroup();
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'cover', assignmentId: 'a3' }, 'ana');
    const kinds = plan(t, DEADLINE).map((i) => i.kind);
    expect(kinds).not.toContain('coverageFollowUp');
    expect(kinds).not.toContain('replacementDuty');
  });
});

describe('Admin alerts', () => {
  /** Ana's default lead time: 3 days before Nov 29's 15:00Z. */
  const ALERT = '2026-11-26T15:00:00.000Z';

  it('Unconfirmed at the Admin’s lead time, once per Assignment and status', () => {
    const t = new TestGroup();
    const alerts = (now: string, p = profiles()) => plan(t, now, p).filter((i) => i.kind === 'adminAlert');
    expect(alerts(plusMinutes(ALERT, -1)).filter((i) => i.assignmentId === 'a3')).toEqual([]);
    const [item] = alerts(ALERT).filter((i) => i.assignmentId === 'a3');
    expect(item).toMatchObject({
      accountId: ACCOUNT.ana,
      title: 'Unconfirmed: Sound, Sun, Nov 29',
      body: "Ben hasn't confirmed Sound on Sun, Nov 29 at 9:00 AM yet. Nothing is declined automatically. · Sunday Team",
      dedupeKey: `adminAlert:g1:a3:sun@2026-11-29:unconfirmed:${ACCOUNT.ana}`,
    });
    // Each Admin's own lead time: 1 day means not yet.
    expect(alerts(ALERT, profiles({ ana: { adminAlertLeadTimeMs: 24 * 60 * 60 * 1000 } })).filter((i) => i.assignmentId === 'a3')).toEqual([]);
  });

  it('none once confirmed, none for the Admin’s own seat, none for Members', () => {
    const t = new TestGroup();
    t.run({ type: 'confirm', assignmentId: 'a3' }, 'ben');
    expect(plan(t, ALERT).some((i) => i.kind === 'adminAlert' && i.assignmentId === 'a3')).toBe(false);
    // Ana's own Nov 22 seat is Unconfirmed from Nov 19, but it's hers.
    expect(plan(t, '2026-11-19T15:00:00.000Z').some((i) => i.kind === 'adminAlert' && i.assignmentId === 'a1')).toBe(false);
    expect(plan(t, ALERT).filter((i) => i.kind === 'adminAlert').every((i) => i.accountId === ACCOUNT.ana)).toBe(true);
  });

  it('catches up when it only turns Needs coverage later', () => {
    const t = new TestGroup();
    const late = plusMinutes(ALERT, 24 * 60);
    t.run({ type: 'confirm', assignmentId: 'a3' }, 'ben');
    t.run({ type: 'decline', assignmentId: 'a3' }, 'ben', late);
    const [item] = plan(t, plusMinutes(late, 15)).filter((i) => i.kind === 'adminAlert' && i.assignmentId === 'a3');
    expect(item.offsetKey).toBe('needsCoverage');
    expect(item.title).toBe('Needs coverage: Sound, Sun, Nov 29');
    expect(item.body).toBe("Sound on Sun, Nov 29 at 9:00 AM still needs someone (Ben can't make it). · Sunday Team");
  });

  it('Placeholders and non-push Admins get nothing', () => {
    const t = new TestGroup();
    expect(plan(t, ALERT, profiles({ ana: { pushEnabled: false } })).some((i) => i.kind === 'adminAlert')).toBe(false);
  });
});

describe('composeMessages', () => {
  const item = (n: number, overrides: Partial<NotificationItem> = {}): NotificationItem => ({
    dedupeKey: `k${n}`,
    accountId: 'acct',
    kind: 'reminder',
    groupId: 'g1',
    groupName: 'Sunday Team',
    assignmentId: `a${n}`,
    eventId: 'e',
    offsetKey: '1d',
    title: `Title ${n}`,
    body: `Body ${n}`,
    url: `/assignment/g1/a${n}`,
    ...overrides,
  });

  it('sends a single item as is', () => {
    expect(composeMessages([item(1)])).toEqual([
      { accountId: 'acct', title: 'Title 1', body: 'Body 1', url: '/assignment/g1/a1', dedupeKeys: ['k1'] },
    ]);
  });

  it('batches per person, most urgent first, capped, opening Home when the links differ', () => {
    const items = [1, 2, 3, 4, 5].map((n) => item(n));
    items[3] = item(4, { kind: 'replacementDuty' });
    const [message] = composeMessages([...items, item(9, { accountId: 'other' })]);
    expect(message.title).toBe('5 updates · Sunday Team');
    expect(message.body.split('\n')).toEqual(['Title 4', 'Title 1', 'Title 2', 'Title 3', 'and 1 more']);
    expect(message.body.split('\n')).toHaveLength(MAX_LINES + 1);
    expect(message.url).toBe('/');
    expect(message.dedupeKeys).toHaveLength(5);
  });

  it('keeps a shared link and drops the group name across Groups', () => {
    const [same] = composeMessages([item(1, { kind: 'covered' }), item(1, { dedupeKey: 'k1b', url: '/assignment/g1/a1?action=cover', kind: 'coverageRequest' })]);
    expect(same.url).toBe('/assignment/g1/a1?action=cover');
    const [mixed] = composeMessages([item(1), item(2, { groupName: 'Hosts' })]);
    expect(mixed.title).toBe('2 updates');
  });
});

describe('the planner as a whole', () => {
  it('plans nothing at a quiet moment', () => {
    expect(plan(new TestGroup(), NOW)).toEqual([]);
  });
});
