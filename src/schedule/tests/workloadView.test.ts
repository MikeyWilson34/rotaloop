import { describe, expect, it } from 'vitest';

import {
  assignmentMakeUpNotices,
  makeUpTurnLines,
  turnsLabel,
  workloadNote,
  workloadSummary,
} from '../workloadView';
import { buildGroup, NOW, run, seat, ZONE } from './fixture';

describe('workloadSummary', () => {
  it('counts upcoming turns per Member across Responsibilities', () => {
    const b = buildGroup();
    const { bars, max, range } = workloadSummary(b.state, NOW);
    // 8 Events × 2 seats, spread over 4 Members.
    const total = [...bars.values()].reduce((n, x) => n + x.total, 0);
    expect(total).toBe(16);
    expect(bars.get('ana')).toEqual({ memberId: 'ana', served: 0, upcoming: 3, covering: 0, total: 3 });
    expect(max).toBe(Math.max(...[...bars.values()].map((x) => x.total)));
    expect(range).not.toBeNull();
  });

  it('counts served turns in the last ~3 months only, and covering toward the coverer', () => {
    const b = buildGroup();
    const ana = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: ana.id }, 'ana');
    run(b, { type: 'cover', assignmentId: ana.id }, 'ben');
    const before = workloadSummary(b.state, NOW).bars.get('ben')!;
    expect(before.covering).toBe(1);
    // After the first two Events, Ben's Cover is history: still "covering".
    const later = '2026-11-30T00:00:00.000Z';
    const after = workloadSummary(b.state, later).bars.get('ben')!;
    expect(after.covering).toBe(1);
    expect(after.served + after.upcoming + after.covering).toBe(after.total);
    const sum = (now: string) => [...workloadSummary(b.state, now).bars.values()].reduce((n, x) => n + x.total, 0);
    expect(sum(later)).toBe(16);
    // Four months on, the November turns have dropped out of the window.
    expect(sum('2027-03-31T00:00:00.000Z')).toBeLessThan(16);
  });

  it('gives Guest Covers to no one', () => {
    const b = buildGroup();
    const g = seat(b.state, '2026-11-22', 'greeter');
    const before = workloadSummary(b.state, NOW);
    run(b, { type: 'decline', assignmentId: g.id }, 'ana');
    run(b, { type: 'markCovered', assignmentId: g.id, by: { guestName: 'Jo' } }, 'ana');
    const after = workloadSummary(b.state, NOW);
    const total = (s: typeof after) => [...s.bars.values()].reduce((n, x) => n + x.total, 0);
    expect(total(after)).toBe(total(before) - 1);
  });

  it('leaves out former Members', () => {
    const b = buildGroup();
    run(b, { type: 'removeMember', memberId: 'cal' }, 'cal');
    expect(workloadSummary(b.state, NOW).bars.has('cal')).toBe(false);
  });
});

describe('workload copy', () => {
  it('explains the range', () => {
    expect(workloadNote({ low: 2, high: 4 })).toBe(
      "everyone has 2–4 turns across the last 3 months and what's scheduled. Covering always counts toward the Member who covers.",
    );
    expect(workloadNote({ low: 1, high: 1 })).toMatch(/^everyone has 1 turn across/);
    expect(workloadNote(null)).toMatch(/^no one is in a Rotation yet\./);
    expect(turnsLabel(1)).toBe('1 turn');
    expect(turnsLabel(3)).toBe('3 turns');
  });
});

describe('Make-up Turns', () => {
  const b = buildGroup();
  const ana = seat(b.state, '2026-11-22', 'sound');
  run(b, { type: 'decline', assignmentId: ana.id }, 'ana');
  run(b, { type: 'cover', assignmentId: ana.id }, 'ben');
  const paying = b.state.assignments.find((a) => a.makeUpTurnId !== null)!;

  it('lists outstanding ones with the turn they are placed on', () => {
    expect(makeUpTurnLines(b.state, 'ana', ZONE)).toEqual(["You take Ben's next Sound turn on Nov 29."]);
    expect(makeUpTurnLines(b.state, 'ben', ZONE)).toEqual(['Ana takes your next Sound turn on Nov 29.']);
    expect(makeUpTurnLines(b.state, 'cal', ZONE)).toEqual(["Ana takes Ben's next Sound turn on Nov 29."]);
  });

  it('explains them on the Assignments involved', () => {
    expect(assignmentMakeUpNotices(b.state, paying.id, 'ana', ZONE)).toEqual({
      paying: "You're taking Ben's turn, because Ben covered you on Nov 22.",
      created: null,
    });
    expect(assignmentMakeUpNotices(b.state, paying.id, 'ben', ZONE).paying).toBe(
      'Ana is taking your turn, because you covered them on Nov 22.',
    );
    expect(assignmentMakeUpNotices(b.state, ana.id, 'cal', ZONE)).toEqual({
      paying: null,
      created: "Ana takes Ben's next Sound turn on Nov 29.",
    });
    expect(assignmentMakeUpNotices(b.state, 'missing', 'ana', ZONE)).toEqual({ paying: null, created: null });
  });

  it('drops paid ones', () => {
    const payAt = b.state.events.find((e) => e.id === paying.eventId)!.startsAt;
    run(b, { type: 'fillSchedule' }, null, new Date(Date.parse(payAt) + 3_600_000).toISOString());
    expect(makeUpTurnLines(b.state, 'ana', ZONE)).toEqual([]);
  });
});
