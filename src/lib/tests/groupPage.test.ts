import { describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { act, NOW, setup, sundays, timeOff, week } from '../../engine/tests/scenario';
import {
  checkJob,
  comingUp,
  dateOffCandidates,
  deleteJobCommands,
  firstName,
  groupDatesOff,
  jobEditCommands,
  jobViews,
  memberItems,
  newJobCommands,
  type TurnRow,
} from '../groupPage';

const ZONE = 'UTC';

/** The "Sunday class": Jordan (the viewer), Sam and Tom (a stand-in), a weekly Teach job. */
function sundayClass(weeks = 8): GroupState {
  const state = setup({
    members: ['jordan', 'sam', 'tom'],
    responsibilities: [{ id: 'teach', qualified: ['jordan', 'sam', 'tom'] }],
    series: [{ id: 'sundays', responsibilityIds: ['teach'] }],
    events: sundays(weeks),
  });
  const names: Record<string, string> = { jordan: 'Jordan Reyes', sam: 'Sam Lee', tom: 'Tom Hart' };
  return {
    ...state,
    responsibilities: state.responsibilities.map((r) => ({ ...r, name: 'Teach' })),
    eventSeries: state.eventSeries.map((s) => ({
      ...s,
      name: 'Teach',
      repeat: {
        frequency: 'weekly',
        intervalWeeks: null,
        daysOfWeek: [0],
        weekOfMonth: null,
        startTime: '09:00',
        timeZone: ZONE,
        startsOn: '2026-12-01',
      },
    })),
    members: state.members.map((m) => ({ ...m, name: names[m.id], accountId: m.id === 'tom' ? null : m.accountId })),
  };
}

const group = (state: GroupState, me: string | null = 'jordan') => ({
  id: 'g1',
  name: 'Sunday class',
  timeZone: ZONE,
  state,
  myMemberId: me,
});

function rows(state: GroupState, me: string | null = 'jordan'): TurnRow[] {
  return comingUp(group(state, me), NOW, ZONE).flatMap((d) => (d.kind === 'turns' ? d.rows : []));
}

function covered(state: GroupState, eventId: string, decliner: string, coverer: string): GroupState {
  const a = state.assignments.find((x) => x.eventId === eventId && x.memberId === decliner)!;
  const next = act(state, { type: 'decline', assignmentId: a.id }, { by: decliner }).state;
  return act(next, { type: 'cover', assignmentId: a.id }, { by: coverer }).state;
}

describe('comingUp', () => {
  it('lists each date with who has it, the viewer\'s own turns marked', () => {
    const list = rows(sundayClass(3));
    expect(list.map((r) => (r.person.kind === 'member' ? r.person.label : r.person.kind))).toEqual(['You', 'Sam', 'Tom']);
    expect(list.map((r) => r.mine)).toEqual([true, false, false]);
    expect(list[0].jobName).toBe('Teach');
  });

  it('marks stand-ins so anyone can act for them', () => {
    const tom = rows(sundayClass(3))[2];
    expect(tom.person).toMatchObject({ kind: 'member', isStandIn: true, label: 'Tom' });
    expect(tom.standInId).toBe('tom');
  });

  it('shows a cover as covering for, and the swap later as swapped with', () => {
    const state = covered(sundayClass(6), 'w2', 'sam', 'tom');
    const list = rows(state, 'sam');
    expect(list[1]).toMatchObject({ coveringFor: 'you', person: { label: 'Tom' } });
    // Sam takes Tom's next turn: "swapped with Tom".
    const swap = list.find((r) => r.swappedWith);
    expect(swap).toMatchObject({ eventId: 'w3', swappedWith: 'Tom', mine: true });
  });

  it('shows a break when someone rests to avoid back-to-back turns', () => {
    let state = covered(sundayClass(8), 'w2', 'sam', 'tom');
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'sam', 3) }, { by: 'sam' }).state;
    const w3 = rows(state).find((r) => r.eventId === 'w3')!;
    expect(w3).toMatchObject({ mine: true, breakFor: 'Tom' });
    expect(rows(state).filter((r) => r.breakFor)).toHaveLength(1);
  });

  it('shows an open request as needing cover, and an outside cover by name', () => {
    let state = sundayClass(4);
    const sams = state.assignments.find((a) => a.eventId === 'w2')!;
    state = act(state, { type: 'decline', assignmentId: sams.id }, { by: 'sam' }).state;
    expect(rows(state)[1]).toMatchObject({ needsCover: true, person: { kind: 'open' } });
    state = act(state, { type: 'markCovered', assignmentId: sams.id, by: { guestName: 'Pat Doe' } }, { by: 'jordan' }).state;
    expect(rows(state)[1]).toMatchObject({ needsCover: false, person: { kind: 'guest', name: 'Pat Doe' }, coveringFor: 'Sam' });
  });

  it('shows a date the whole group has off as one off day', () => {
    const state = act(sundayClass(4), { type: 'addSkipDate', eventId: 'w2' }, { by: 'jordan' }).state;
    const days = comingUp(group(state), NOW, ZONE);
    expect(days.map((d) => d.kind)).toEqual(['turns', 'off', 'turns', 'turns']);
  });
});

describe('memberItems', () => {
  it('lists members in join order, stand-ins marked', () => {
    expect(memberItems(sundayClass(), 'sam')).toEqual([
      { id: 'jordan', name: 'Jordan Reyes', isMe: false, isStandIn: false },
      { id: 'sam', name: 'Sam Lee', isMe: true, isStandIn: false },
      { id: 'tom', name: 'Tom Hart', isMe: false, isStandIn: true },
    ]);
  });

  it('firstName', () => {
    expect(firstName('  Sam  Lee ')).toBe('Sam');
  });
});

describe('jobs', () => {
  const now = new Date(NOW);

  it('reads each job as its sentence row', () => {
    const [job] = jobViews(sundayClass(), ZONE, now);
    expect(job).toMatchObject({ name: 'Teach', seriesId: 'sundays', ownSeries: true, description: 'every Sunday · 9:00am' });
    expect(job.draft).toMatchObject({ repeat: { kind: 'week', weekday: 0 }, time: '09:00', type: 'turns' });
  });

  it('renaming sends the job and its dates the new name; same when sends nothing more', () => {
    const state = sundayClass();
    const [job] = jobViews(state, ZONE, now);
    expect(jobEditCommands(state, job, { ...job.draft, name: 'Teaching' }, ZONE, now)).toEqual([
      { type: 'editResponsibility', responsibilityId: 'teach', changes: { name: 'Teaching' } },
      { type: 'editEventSeries', seriesId: 'sundays', changes: { name: 'Teaching' } },
    ]);
    expect(jobEditCommands(state, job, job.draft, ZONE, now)).toEqual([]);
  });

  it('a new "when" replaces the pattern (the server lists the new dates)', () => {
    const state = sundayClass();
    const [job] = jobViews(state, ZONE, now);
    const [cmd] = jobEditCommands(state, job, { ...job.draft, repeat: { ...job.draft.repeat, kind: '2week' } }, ZONE, now);
    expect(cmd).toMatchObject({ type: 'editEventSeries', changes: { repeat: { frequency: 'biweekly', daysOfWeek: [0] } } });
  });

  it('a one-off gets its single date', () => {
    const state = sundayClass();
    const [job] = jobViews(state, ZONE, now);
    const draft = { ...job.draft, repeat: { ...job.draft.repeat, kind: 'once' as const, date: '2026-12-24' }, time: '18:00' };
    expect(jobEditCommands(state, job, draft, ZONE, now)).toEqual([
      {
        type: 'editEventSeries',
        seriesId: 'sundays',
        changes: { repeat: null },
        replaceFutureEvents: [{ id: 'sundays@20261224T1800Z', seriesId: 'sundays', startsAt: '2026-12-24T18:00:00.000Z' }],
      },
    ]);
  });

  it('adding a job: everyone does it, with its own dates', () => {
    const state = sundayClass();
    const draft = { name: ' Coffee ', repeat: { kind: 'week' as const, weekday: 6, nth: 1, date: '2026-12-08' }, time: '10:00', type: 'turns' as const };
    const [add, series] = newJobCommands(state, draft, ZONE, now, () => 0.5);
    expect(add).toMatchObject({
      type: 'addResponsibility',
      responsibility: { name: 'Coffee', headcount: 1, requiresConfirmation: false },
      qualifiedMemberIds: ['jordan', 'sam', 'tom'],
    });
    expect(series).toMatchObject({ type: 'addEventSeries', series: { name: 'Coffee', repeat: { frequency: 'weekly', daysOfWeek: [6] } } });
    expect(series).not.toHaveProperty('events');
  });

  it('deleting a job removes its dates and the job', () => {
    const [job] = jobViews(sundayClass(), ZONE, now);
    expect(deleteJobCommands(job).map((c) => c.type)).toEqual(['removeEventSeries', 'removeResponsibility']);
  });

  it('checks names and one-off dates', () => {
    const state = sundayClass();
    const [job] = jobViews(state, ZONE, now);
    expect(checkJob(state, { ...job.draft, name: ' ' }, null, ZONE, now)).toMatchObject({ ok: false });
    expect(checkJob(state, { ...job.draft, name: 'teach' }, null, ZONE, now)).toMatchObject({ ok: false });
    expect(checkJob(state, { ...job.draft, name: 'teach' }, 'teach', ZONE, now)).toEqual({ ok: true, name: 'teach' });
    const past = { ...job.draft, repeat: { ...job.draft.repeat, kind: 'once' as const, date: '2026-11-01' } };
    expect(checkJob(state, past, 'teach', ZONE, now)).toMatchObject({ ok: false });
  });
});

describe('group dates off', () => {
  const now = new Date(NOW);

  it('lists skipped dates, and the dates that can still be made one', () => {
    const state = act(sundayClass(4), { type: 'addSkipDate', eventId: 'w2' }, { by: 'jordan' }).state;
    expect(groupDatesOff(state, ZONE, now)).toEqual([{ date: week(2).slice(0, 10), eventIds: ['w2'] }]);
    expect(dateOffCandidates(state, ZONE, now).map((d) => d.eventIds)).toEqual([['w1'], ['w3'], ['w4']]);
  });
});
