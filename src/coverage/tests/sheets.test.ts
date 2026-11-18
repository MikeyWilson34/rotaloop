import { describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { buildGroup, NOW, run, seat, ZONE } from '../../schedule/tests/fixture';
import {
  coveragePanelView,
  coveredByName,
  coverSheetView,
  declineReasonText,
  declineSheetView,
  markCoveredSheetView,
  nameList,
  qualifiedToAsk,
  successMessage,
  type SheetContext,
} from '../sheets';

/** After the Nov 29 deadline (Nov 26, 15:00 UTC). */
const LATE = '2026-11-27T12:00:00.000Z';

const ctx = (state: GroupState, me = 'ana', now = NOW): SheetContext => ({
  state,
  groupName: 'Sunday Team',
  viewerTimeZone: ZONE,
  me,
  now,
});

/** Ben declines his Nov 29 Sound turn (a3). Cal is the Greeter that day. */
function bensRequest() {
  const built = buildGroup();
  run(built, { type: 'decline', assignmentId: seat(built.state, '2026-11-29', 'sound').id }, 'ben');
  return { built, id: seat(built.state, '2026-11-29', 'sound').id };
}

describe('qualifiedToAsk / nameList', () => {
  it('lists active Qualified Members with an account, except the given ones', () => {
    const { state } = buildGroup();
    expect(qualifiedToAsk(state, 'sound', ['ben'])).toEqual(['ana', 'cal']);
    // Pat is a Placeholder: on the Greeter team, but can't be asked.
    expect(qualifiedToAsk(state, 'greeter', [])).toEqual(['cal', 'ben']);
  });

  it('joins names', () => {
    expect(nameList(['Ben'])).toBe('Ben');
    expect(nameList(['Ben', 'Cal'])).toBe('Ben and Cal');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });
});

describe('declineSheetView', () => {
  it('asks the Qualified Members except me, with the deadline and Pay It Back', () => {
    const { state } = buildGroup();
    const v = declineSheetView(ctx(state), seat(state, '2026-11-22', 'sound').id)!;
    expect(v.overline).toBe('Sunday Team · Sun, Nov 22');
    expect(v.title).toBe("Can't make Sound?");
    expect(v.ask.names).toEqual(['Ben', 'Cal']);
    expect(v.ask.line).toBe('On the Sound team');
    expect(v.message).toMatch(/^No problem\. We'll send a Coverage Request to the Sound team\./);
    expect(v.deadlineNote).toBe(
      "The first to accept gets it. If nobody does by Thu, Nov 19, you'll be asked to find a replacement.",
    );
    expect(v.payItBack).toBe(
      "Sunday Team uses Pay It Back: whoever covers you is owed a Make-up Turn. You'll take their next Sound turn.",
    );
    expect(v.makeUpNote).toBeNull();
    expect(v.withdrawingCover).toBe(false);
    expect(v.submitLabel).toBe('Send Coverage Request');
  });

  it('Admins duty, Count Real Work, and a passed deadline', () => {
    const built = buildGroup();
    run(built, { type: 'changeSettings', settings: { replacementDuty: 'admins', coveragePolicy: 'countRealWork' } }, 'ana');
    const v = declineSheetView(ctx(built.state, 'ben', LATE), seat(built.state, '2026-11-29', 'sound').id)!;
    expect(v.ask.names).toEqual(['Ana', 'Cal']);
    expect(v.deadlineNote).toBe(
      'The first to accept gets it. The "find a replacement by" date has passed, so if nobody accepts, the Admins will find a replacement.',
    );
    expect(v.payItBack).toBeNull();
  });

  it('says so when no one else is Qualified', () => {
    const built = buildGroup();
    run(built, { type: 'unqualifyMember', memberId: 'ben', responsibilityId: 'sound' }, 'ana');
    run(built, { type: 'unqualifyMember', memberId: 'cal', responsibilityId: 'sound' }, 'ana');
    const v = declineSheetView(ctx(built.state), seat(built.state, '2026-11-22', 'sound').id)!;
    expect(v.ask.names).toEqual([]);
    expect(v.ask.line).toMatch(/No one else is on the Sound team/);
  });

  it('a Make-up Turn: declining it settles the debt and moves it along', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    // Ben now pays Ana's Dec 13 Sound turn.
    const paying = built.state.assignments.find((a) => a.makeUpTurnId !== null)!;
    expect(paying.memberId).toBe('ben');
    const v = declineSheetView(ctx(built.state, 'ben'), paying.id)!;
    expect(v.makeUpNote).toBe(
      "This is a Make-up Turn. Declining it settles your debt to Ana; you'll owe whoever covers instead.",
    );
  });

  it('withdrawing my Cover reopens the request and cancels the Make-up Turn', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    const v = declineSheetView(ctx(built.state, 'ana'), id)!;
    expect(v.withdrawingCover).toBe(true);
    expect(v.title).toBe("Can't cover Sound after all?");
    expect(v.message).toBe('The Coverage Request opens again for Ben, and the Sound team is asked again.');
    expect(v.ask.names).toEqual(['Cal']);
    expect(v.payItBack).toBe('The Make-up Turn Ben owes you for this is cancelled.');
    expect(v.deadlineNote).toMatch(/Ben will be asked to find a replacement\.$/);
    expect(v.submitLabel).toBe('Withdraw my Cover');
  });
});

describe('coverSheetView (engine preview)', () => {
  it('previews the Make-up Turn date without changing the state', () => {
    const { built, id } = bensRequest();
    const before = JSON.stringify(built.state);
    const v = coverSheetView(ctx(built.state, 'ana'), id)!;
    expect(JSON.stringify(built.state)).toBe(before);
    expect(v.title).toBe('Cover Sound for Ben?');
    expect(v.date).toBe('2026-11-29');
    expect(v.workloadNote).toBe('Thank you! Covering counts toward your workload in Sunday Team.');
    // Ana's next Sound turn after Nov 29 is Dec 13.
    expect(v.makeUpDate).toBe('2026-12-13');
    expect(v.makeUp).toBe("Pay It Back: Ben will owe you a Make-up Turn. They'll take your Sound turn on Sun, Dec 13.");
    expect(v.problem).toBeNull();
  });

  it('Count Real Work: no Make-up Turn', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'changeSettings', settings: { coveragePolicy: 'countRealWork' } }, 'ana');
    const v = coverSheetView(ctx(built.state, 'ana'), id)!;
    expect(v.makeUp).toBe('Sunday Team uses Count Real Work, so no Make-up Turn is owed.');
    expect(v.makeUpDate).toBeNull();
  });

  it('reports why the engine would refuse (Cal is already the Greeter that day)', () => {
    const { built, id } = bensRequest();
    expect(coverSheetView(ctx(built.state, 'cal'), id)!.problem).toBe('alreadyAssignedAtEvent');
  });
});

describe('markCoveredSheetView', () => {
  it('any Group Member except the decliner; busy ones disabled, Qualified first', () => {
    const { built, id } = bensRequest();
    const v = markCoveredSheetView(ctx(built.state, 'ana'), id)!;
    expect(v.title).toBe("Who's covering Sound?");
    expect(v.options).toEqual([
      { memberId: 'ana', name: 'You', detail: 'On the Sound team', disabled: false },
      { memberId: 'pat', name: 'Pat', detail: 'Group Member', disabled: false },
      { memberId: 'cal', name: 'Cal', detail: 'Already at this Event', disabled: true },
    ]);
    expect(v.guestNote).toMatch(/^A Guest Cover is recorded by name only\./);
  });

  it('doubling allowed: someone at another Responsibility is available', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    const cal = markCoveredSheetView(ctx(built.state, 'ana'), id)!.options.find((o) => o.memberId === 'cal');
    expect(cal).toEqual({ memberId: 'cal', name: 'Cal', detail: 'On the Sound team', disabled: false });
  });
});

describe('coveragePanelView', () => {
  it('before the deadline: who can’t make it and who was asked', () => {
    const { built, id } = bensRequest();
    const a = built.state.assignments.find((x) => x.id === id)!;
    const startsAt = '2026-11-29T15:00:00.000Z';
    expect(coveragePanelView(built.state, a, startsAt, 'ana', true, NOW)).toEqual({
      headline: 'Ben can’t make it',
      detail: 'Asked 2 people on the Sound team. The first to accept gets it. We’ll remind them once more before the Event.',
      asked: ['You', 'Cal'],
      reason: null,
    });
    expect(coveragePanelView(built.state, a, startsAt, 'ben', false, NOW)!.headline).toBe(
      'We’re finding someone to cover you',
    );
  });

  it('after the deadline: Replacement Duty', () => {
    const { built, id } = bensRequest();
    const a = built.state.assignments.find((x) => x.id === id)!;
    const startsAt = '2026-11-29T15:00:00.000Z';
    expect(coveragePanelView(built.state, a, startsAt, 'ben', false, LATE)!.headline).toBe(
      'Nobody’s free. Please find a replacement.',
    );
    const admin = coveragePanelView(built.state, a, startsAt, 'ana', true, LATE)!;
    expect(admin.headline).toBe('Nobody’s free. Ben is finding a replacement.');
    expect(admin.detail).toMatch(/Replacement Duty is on Ben\. You’re informed; no action needed\.$/);
  });

  it('nothing for an Assignment that isn’t an open request', () => {
    const { state } = buildGroup();
    expect(coveragePanelView(state, seat(state, '2026-11-22', 'sound'), '2026-11-22T15:00:00.000Z', 'ana', true, NOW)).toBeNull();
  });
});

describe('Decline reasons (ticket 16)', () => {
  it('composes "Chip: note" like the prototype, capped at 300 characters', () => {
    expect(declineReasonText('Traveling', ' back on the 10th ')).toBe('Traveling: back on the 10th');
    expect(declineReasonText('Sick', '')).toBe('Sick');
    expect(declineReasonText(null, 'Dentist')).toBe('Dentist');
    expect(declineReasonText(null, '  ')).toBeNull();
    expect(declineReasonText('Other', 'x'.repeat(400))).toHaveLength(300);
  });

  it('shows the reason on the Cover sheet and the coverage panel', () => {
    const built = buildGroup();
    const id = seat(built.state, '2026-11-29', 'sound').id;
    run(built, { type: 'decline', assignmentId: id, reason: 'Traveling: back on the 10th' }, 'ben');
    expect(coverSheetView(ctx(built.state, 'ana'), id)!.reason).toBe('Traveling: back on the 10th');
    const a = built.state.assignments.find((x) => x.id === id)!;
    expect(coveragePanelView(built.state, a, '2026-11-29T15:00:00.000Z', 'ana', false, NOW)!.reason).toBe(
      'Traveling: back on the 10th',
    );
  });

  it('no reason: null', () => {
    const { built, id } = bensRequest();
    expect(coverSheetView(ctx(built.state, 'ana'), id)!.reason).toBeNull();
  });

  it('the decline sheet invites a reason', () => {
    const { state } = buildGroup();
    expect(declineSheetView(ctx(state), seat(state, '2026-11-22', 'sound').id)!.message).toMatch(/A reason is optional but helps.$/);
  });

  it('withdrawing a Decline', () => {
    expect(successMessage('withdrawDecline', 'Sound', '2026-11-22')).toBe(
      'You’re back on Sound for Sun, Nov 22. The Coverage Request is withdrawn.',
    );
  });
});

describe('successMessage / coveredByName', () => {
  it('plain confirmations', () => {
    expect(successMessage('confirm', 'Sound', '2026-11-22')).toBe('Confirmed Sound for Sun, Nov 22. Thank you!');
    expect(successMessage('cover', 'Sound', '2026-11-22')).toBe('You’re covering Sound on Sun, Nov 22. Thank you!');
    expect(successMessage('markCovered', 'Sound', '2026-11-22', 'Jo Blake (guest)')).toBe('Marked covered by Jo Blake (guest).');
    expect(successMessage('decline', 'Sound', '2026-11-22')).toMatch(/^Coverage Request sent\./);
    expect(successMessage('withdrawCover', 'Sound', '2026-11-22')).toMatch(/open again\.$/);
  });

  it('names whoever won a Cover race', () => {
    const { built, id } = bensRequest();
    expect(coveredByName(built.state, id, 'cal')).toBeNull();
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    expect(coveredByName(built.state, id, 'cal')).toBe('Ana');
    expect(coveredByName(built.state, id, 'ana')).toBe('you');
  });

  it('a Guest Cover by name', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'markCovered', assignmentId: id, by: { guestName: 'Jo Blake' } }, 'ben');
    expect(coveredByName(built.state, id, 'ana')).toBe('Jo Blake (guest)');
  });
});
