import { describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { coverSentence, type HistoryContext } from '../../schedule/history';
import { buildGroup, NOW, run, seat, ZONE } from '../../schedule/tests/fixture';
import {
  busyNote,
  busyThatDay,
  cantMakeItView,
  coveredByName,
  coverPickerView,
  coverPreviewMessage,
  isStandIn,
  nameList,
  needsCoverView,
  outsideCoverName,
  qualifiedToAsk,
  successMessage,
  type SheetContext,
} from '../sheets';

// The fixture's turns: Nov 29 Sound is Ben's and Greeter Cal's; Dec 13 Sound is Ana's. Pat is a
// Stand-in (no account).
const ctx = (state: GroupState, me = 'ana'): SheetContext => ({
  state,
  groupName: 'Sunday Team',
  viewerTimeZone: ZONE,
  groupTimeZone: ZONE,
  me,
  now: NOW,
});

/** Ben can't make his Nov 29 Sound turn and asks the group. */
function bensRequest() {
  const built = buildGroup();
  const id = seat(built.state, '2026-11-29', 'sound').id;
  run(built, { type: 'decline', assignmentId: id }, 'ben');
  return { built, id };
}

const hctx = (state: GroupState, me: string): HistoryContext => ({ state, myMemberId: me, timeZone: ZONE });

describe('helpers', () => {
  it('lists Members on the app in the rotation, except the given ones', () => {
    const { state } = buildGroup();
    expect(qualifiedToAsk(state, 'sound', ['ben'])).toEqual(['ana', 'cal']);
    expect(qualifiedToAsk(state, 'greeter', [])).toEqual(['cal', 'ben']);
  });

  it('joins names', () => {
    expect(nameList(['Ben', 'Cal'])).toBe('Ben and Cal');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('knows a Stand-in', () => {
    const { state } = buildGroup();
    expect(isStandIn(state, 'pat')).toBe(true);
    expect(isStandIn(state, 'ben')).toBe(false);
    expect(isStandIn(state, null)).toBe(false);
  });

  it('busy that day: another job in the group on that date', () => {
    const { built, id } = bensRequest();
    const a = built.state.assignments.find((x) => x.id === id)!;
    expect(busyThatDay(built.state, a, 'cal', ZONE)).toBe(true);
    expect(busyThatDay(built.state, a, 'ana', ZONE)).toBe(false);
    // Ben's own open request doesn't count as a job that day.
    expect(busyThatDay(built.state, a, 'ben', ZONE)).toBe(false);
    expect(busyNote('Sunday Team')).toBe('You already have another job in Sunday Team that day.');
  });
});

describe('"Can\'t make it?"', () => {
  it('a details line and two choices', () => {
    const { state } = buildGroup();
    const v = cantMakeItView(ctx(state, 'ben'), seat(state, '2026-11-29', 'sound').id)!;
    expect(v).toEqual({
      title: "Can't make it?",
      details: 'Sound · Sun, Nov 29 · 9:00 AM',
      message: 'Pick how to get it covered. Turns stay fair automatically.',
      withdrawingCover: false,
      askLabel: 'Ask the group for cover',
      findLabel: "I'll find someone to cover",
    });
  });

  it('the coverer can only hand it back to the group', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    const v = cantMakeItView(ctx(built.state), id)!;
    expect(v.title).toBe("Can't cover after all?");
    expect(v.withdrawingCover).toBe(true);
    expect(v.findLabel).toBeNull();
  });
});

describe('"Who is covering?"', () => {
  it('everyone but the person who can’t make it, Stand-ins included; busy ones disabled', () => {
    const { state } = buildGroup();
    const v = coverPickerView(ctx(state, 'ben'), seat(state, '2026-11-29', 'sound').id)!;
    expect(v.title).toBe('Who is covering?');
    expect(v.otherLabel).toBe('Someone else');
    expect(v.options).toEqual([
      { memberId: 'ana', name: 'Ana', detail: null, disabled: false },
      { memberId: 'pat', name: 'Pat', detail: 'Stand-in', disabled: false },
      { memberId: 'cal', name: 'Cal', detail: 'Already on another job then', disabled: true },
    ]);
  });

  it('on an open request: excludes whoever asked, lists me as "You" first', () => {
    const { built, id } = bensRequest();
    const v = coverPickerView(ctx(built.state, 'ana'), id)!;
    expect(v.options.map((o) => o.name)).toEqual(['You', 'Pat', 'Cal']);
  });

  it('an outside name is trimmed, and an empty one is not accepted', () => {
    expect(outsideCoverName('  Jo   Quinn ')).toBe('Jo Quinn');
    expect(outsideCoverName('   ')).toBeNull();
    expect(outsideCoverName('x'.repeat(200))!.length).toBe(80);
  });
});

describe('the note on a turn that needs cover', () => {
  it('for whoever asked, for someone free, and for someone busy that day', () => {
    const { built, id } = bensRequest();
    expect(needsCoverView(ctx(built.state, 'ben'), id, false)).toEqual({
      headline: 'Needs cover',
      detail: 'We’ll tell you when someone takes it. The first person to tap “I’ll cover” takes it.',
      reason: null,
    });
    expect(needsCoverView(ctx(built.state, 'ana'), id, false)!.detail).toBe(
      'Ben can’t make it. The first person to tap “I’ll cover” takes it.',
    );
    expect(needsCoverView(ctx(built.state, 'cal'), id, true)!.detail).toBe(
      'Ben can’t make it. You already have another job in Sunday Team that day.',
    );
  });

  it('nothing once covered', () => {
    const { built, id } = bensRequest();
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    expect(needsCoverView(ctx(built.state, 'ana'), id, false)).toBeNull();
  });
});

describe('the swap sentence (engine dates)', () => {
  it('"I\'ll cover": told from the coverer’s, the asker’s and anyone else’s side', () => {
    const { built, id } = bensRequest();
    expect(coverPreviewMessage(ctx(built.state, 'ana'), { type: 'cover', assignmentId: id })).toBe(
      "You're covering Ben's Sound turn on Nov 29. Ben takes your next turn on Dec 13.",
    );
    run(built, { type: 'cover', assignmentId: id }, 'ana');
    const entry = built.history[built.history.length - 1];
    expect(coverSentence(entry, hctx(built.state, 'ben'))).toBe(
      "Ana's covering for you on Nov 29. You'll take Ana's next turn on Dec 13.",
    );
    expect(coverSentence(entry, hctx(built.state, 'cal'))).toBe(
      "Ana is covering Ben's Sound turn on Nov 29. Ben takes Ana's next turn on Dec 13.",
    );
    // The swap really is in the schedule: Ben now holds Dec 13.
    expect(seat(built.state, '2026-12-13', 'sound').memberId).toBe('ben');
  });

  it('"I\'ll find someone to cover": the same sentence, in one step', () => {
    const { state } = buildGroup();
    const id = seat(state, '2026-11-29', 'sound').id;
    expect(coverPreviewMessage(ctx(state, 'ben'), { type: 'decline', assignmentId: id, coveredBy: { memberId: 'ana' } })).toBe(
      "Ana's covering for you on Nov 29. You'll take Ana's next turn on Dec 13.",
    );
  });

  it('an outside cover has no swap sentence', () => {
    const { state } = buildGroup();
    const id = seat(state, '2026-11-29', 'sound').id;
    const command = { type: 'decline' as const, assignmentId: id, coveredBy: { guestName: 'Jo Quinn' } };
    expect(coverPreviewMessage(ctx(state, 'ben'), command)).toBe("Jo Quinn's covering for you on Nov 29.");
    expect(coverPreviewMessage(ctx(state, 'ana'), { type: 'markCovered', assignmentId: id, by: { guestName: 'Jo' } })).toBeNull();
  });

  it('"Pick who\'s covering" on someone else’s request', () => {
    const { built, id } = bensRequest();
    expect(coverPreviewMessage(ctx(built.state, 'cal'), { type: 'markCovered', assignmentId: id, by: { memberId: 'ana' } })).toBe(
      "Ana is covering Ben's Sound turn on Nov 29. Ben takes Ana's next turn on Dec 13.",
    );
  });

  it('null when the engine would refuse it (Cal already greets that day)', () => {
    const { built, id } = bensRequest();
    expect(coverPreviewMessage(ctx(built.state, 'cal'), { type: 'cover', assignmentId: id })).toBeNull();
  });
});

describe('successMessage / coveredByName', () => {
  it('plain confirmations', () => {
    expect(successMessage('confirm', 'Sound', '2026-11-22')).toBe('Confirmed Sound for Sun, Nov 22. Thank you!');
    expect(successMessage('withdrawDecline', 'Sound', '2026-11-22')).toBe('You’re back on Sound for Sun, Nov 22.');
    expect(successMessage('cover', 'Sound', '2026-11-22')).toBe('You’re covering Sound on Sun, Nov 22. Thank you!');
    expect(successMessage('markCovered', 'Sound', '2026-11-22', 'Jo')).toBe('Jo is covering Sound on Sun, Nov 22.');
  });

  it('who won the race, an outside cover "not in group"', () => {
    const { built, id } = bensRequest();
    expect(coveredByName(built.state, id, 'ana')).toBeNull();
    run(built, { type: 'markCovered', assignmentId: id, by: { guestName: 'Jo Quinn' } }, 'cal');
    expect(coveredByName(built.state, id, 'ana')).toBe('Jo Quinn (not in group)');
  });
});
