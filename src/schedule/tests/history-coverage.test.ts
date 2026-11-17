/**
 * Ticket 16 additions to the history sentences: Decline reasons, withdrawing a Decline, and
 * the moved notice when only the time changed. Kept apart from history.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { assignmentHistory, describeAssignmentChange, historyLines, movedNotice, type HistoryContext } from '../history';
import { buildGroup, eventId, run, seat, ZONE } from './fixture';

const ctxOf = (b: ReturnType<typeof buildGroup>, me: string | null = 'cal'): HistoryContext => ({
  state: b.state,
  myMemberId: me,
  timeZone: ZONE,
});

describe('Decline reasons in history', () => {
  it('quotes the reason in the entry and in the Assignment timeline', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id, reason: 'Traveling: back on the 10th' }, 'ana');
    expect(historyLines(b.history, ctxOf(b))[0].text).toBe(
      "Ana can't make Sound on Sun, Nov 22: “Traveling: back on the 10th”. Coverage requested.",
    );
    expect(assignmentHistory(b.history, a.id, ctxOf(b)).at(-1)!.text).toBe(
      "Ana can't make it: “Traveling: back on the 10th”. Needs coverage",
    );
  });

  it('no reason: the sentence is unchanged', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    expect(historyLines(b.history, ctxOf(b))[0].text).toBe("Ana can't make Sound on Sun, Nov 22. Coverage requested.");
  });
});

describe('withdrawDecline in history', () => {
  it('"Ana can make it after all; Coverage Request withdrawn"', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    run(b, { type: 'withdrawDecline', assignmentId: a.id }, 'ana');
    const line = historyLines(b.history, ctxOf(b))[0];
    expect(line).toMatchObject({
      text: 'Ana can make Sound on Sun, Nov 22 after all; Coverage Request withdrawn.',
      detail: null,
      tone: 'ok',
    });
    expect(historyLines(b.history, ctxOf(b, 'ana'))[0].text).toBe(
      'You can make Sound on Sun, Nov 22 after all; Coverage Request withdrawn.',
    );
    expect(assignmentHistory(b.history, a.id, ctxOf(b)).at(-1)!.text).toBe('Back with Ana');
  });

  it('an Admin speaking for a Placeholder Member', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'greeter');
    expect(a.memberId).toBe('pat');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    run(b, { type: 'withdrawDecline', assignmentId: a.id }, 'ana');
    expect(historyLines(b.history, ctxOf(b))[0].text).toBe(
      'Ana said Pat can make Greeter on Sun, Nov 22 after all; Coverage Request withdrawn.',
    );
  });
});

describe('moved notice', () => {
  it('only the time changed on the same day: shows both times and the date once', () => {
    const b = buildGroup();
    // A one-off Event the same Sunday at 10:30 AM Chicago time.
    run(b, { type: 'addEvents', events: [{ id: 'late', seriesId: null, startsAt: '2026-11-22T16:30:00.000Z', responsibilityIds: ['sound'] }] }, 'ana');
    const a = seat(b.state, '2026-11-22', 'sound');
    const change = { assignmentId: a.id, before: a, after: { ...a, eventId: 'late' }, reason: { type: 'fillSchedule' as const } };
    expect(describeAssignmentChange(change, ctxOf(b)).text).toBe('Moved from 9:00 AM to 10:30 AM on Sun, Nov 22');
    b.history.push({ id: '999', at: '2026-11-19T00:00:00.000Z', actorId: 'ana', cause: { type: 'removeEvent', eventId: 'x' }, changes: [change], makeUpTurns: [] });
    expect(movedNotice(b.history, a.id, ctxOf(b))).toMatch(/^Moved from 9:00 AM to 10:30 AM on Sun, Nov 22\. /);
  });

  it('a different day still names both dates', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    const change = { assignmentId: a.id, before: a, after: { ...a, eventId: eventId('2026-11-29') }, reason: { type: 'fillSchedule' as const } };
    expect(describeAssignmentChange(change, ctxOf(b)).text).toBe('Moved from Sun, Nov 22 to Sun, Nov 29');
  });
});
