import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../engine';
import { describeHistoryEntry } from '../history';
import {
  addMonthsClamped,
  batchOf,
  dateRuns,
  MONTHLY_OCCURRENCES,
  myResponsibilityNames,
  newBatchId,
  rangeDates,
  savedToast,
  saveLabel,
  servingDates,
  timeOffDates,
  timeOffEntries,
  timeOffItems,
  timeOffPlan,
  timeOffPreview,
  toggleDate,
  toggleScope,
  type TimeOffDraft,
  type TimeOffGroup,
} from '../timeOff';
import { buildGroup, NOW, run, seat, ZONE } from './fixture';

const VIEWER = ZONE;

function group(state = buildGroup().state, myMemberId = 'ana', name = 'Sunday Team', id = state.groupId): TimeOffGroup {
  return { id, name, timeZone: ZONE, state, myMemberId };
}

const draft = (dates: string[], extra: Partial<TimeOffDraft> = {}): TimeOffDraft => ({
  dates,
  repeat: 'none',
  scope: 'all',
  note: '',
  ...extra,
});

describe('picking days', () => {
  it('toggles single days, keeping them sorted', () => {
    expect(toggleDate(['2026-12-13'], '2026-12-06')).toEqual(['2026-12-06', '2026-12-13']);
    expect(toggleDate(['2026-12-06', '2026-12-13'], '2026-12-06')).toEqual(['2026-12-13']);
  });

  it('fills a range either way round, across a month end', () => {
    expect(rangeDates('2027-01-02', '2026-12-30')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('groups days into runs of consecutive days', () => {
    expect(dateRuns(['2026-12-13', '2026-12-06', '2026-12-07', '2026-12-08'])).toEqual([
      { from: '2026-12-06', to: '2026-12-08' },
      { from: '2026-12-13', to: '2026-12-13' },
    ]);
  });

  it('moves a date by months, clamping to the month end', () => {
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsClamped('2026-12-13', 2)).toBe('2027-02-13');
  });

  it('labels the save button', () => {
    expect(saveLabel(draft([]))).toBe('Save');
    expect(saveLabel(draft(['2026-12-13']))).toBe('Save 1 day');
    expect(saveLabel(draft(['2026-12-13', '2026-12-14']))).toBe('Save 2 days');
  });

  it('makes batch ids and reads them back from Time Off ids', () => {
    const id = newBatchId(() => 0.5);
    expect(id).toMatch(/^to[0-9a-z]{8}$/);
    expect(batchOf(`${id}-r2`)).toBe(id);
    expect(batchOf(`${id}-r1m12`)).toBe(id);
    expect(batchOf('t1')).toBe('t1');
  });
});

describe('"Applies to"', () => {
  it("lists the Responsibilities I'm Qualified for across my Groups, once each", () => {
    const a = group();
    const b = group(buildGroup().state, 'cal', 'Other Team', 'g2');
    expect(myResponsibilityNames([a])).toEqual(['Sound']);
    expect(myResponsibilityNames([a, b])).toEqual(['Sound', 'Greeter']);
  });

  it('toggles chips: All clears the rest, and the last one off means All again', () => {
    expect(toggleScope('all', 'Sound')).toEqual(['Sound']);
    expect(toggleScope(['Sound'], 'Greeter')).toEqual(['Sound', 'Greeter']);
    expect(toggleScope(['Sound'], 'Sound')).toBe('all');
    expect(toggleScope(['Sound'], 'all')).toBe('all');
  });

  it('writes only to Groups that have a picked Responsibility', () => {
    const a = group();
    const other = { ...group(buildGroup().state, 'cal', 'Other', 'g2') };
    other.state = { ...other.state, responsibilities: other.state.responsibilities.map((r) => ({ ...r, name: `${r.name}2` })) };
    const plan = timeOffPlan(draft(['2026-12-13'], { scope: ['Sound'] }), [a, other], 'tox');
    expect(plan.map((p) => p.group.name)).toEqual(['Sunday Team']);
    expect(plan[0].entries[0].responsibilityIds).toEqual(['sound']);
  });
});

describe('draft -> engine Time Off', () => {
  it('a single day is local midnight to midnight in the Group time zone', () => {
    expect(timeOffEntries(draft(['2026-12-13'], { note: ' Trip ' }), group(), 'tox')).toEqual([
      {
        id: 'tox-r1',
        memberId: 'ana',
        startsAt: '2026-12-13T06:00:00.000Z',
        endsAt: '2026-12-14T06:00:00.000Z',
        responsibilityIds: null,
        note: 'Trip',
      },
    ]);
  });

  it('weekly and every other week repeat in the Group time zone (so DST keeps local days)', () => {
    const [weekly] = timeOffEntries(draft(['2026-12-13'], { repeat: 'weekly' }), group(), 'tox');
    expect(weekly).toMatchObject({ repeatEveryWeeks: 1, timeZone: ZONE });
    const [biweekly] = timeOffEntries(draft(['2026-12-13'], { repeat: 'biweekly' }), group(), 'tox');
    expect(biweekly).toMatchObject({ repeatEveryWeeks: 2, timeZone: ZONE });
  });

  it('every month becomes separate Time Off entries, each at local midnight across DST', () => {
    const entries = timeOffEntries(draft(['2027-01-31'], { repeat: 'monthly' }), group(), 'tox');
    expect(entries).toHaveLength(MONTHLY_OCCURRENCES);
    expect(entries[0]).toMatchObject({ id: 'tox-r1m1', startsAt: '2027-01-31T06:00:00.000Z' });
    expect(entries[1]).toMatchObject({ id: 'tox-r1m2', startsAt: '2027-02-28T06:00:00.000Z' });
    // April 2027 is daylight time in Chicago: midnight is 05:00 UTC.
    expect(entries[3]).toMatchObject({ startsAt: '2027-04-30T05:00:00.000Z', endsAt: '2027-05-01T05:00:00.000Z' });
    expect(entries.every((e) => !e.repeatEveryWeeks)).toBe(true);
  });

  it('a repeating Time Off stays on its local Sunday on both sides of the March DST change', () => {
    const [weekly] = timeOffEntries(draft(['2027-03-07'], { repeat: 'weekly' }), group(), 'tox');
    const b = buildGroup();
    run(b, {
      type: 'addEvents',
      events: ['2027-03-07T15:00:00.000Z', '2027-03-14T14:00:00.000Z', '2027-03-21T14:00:00.000Z'].map((startsAt, i) => ({
        id: `dst${i}`,
        seriesId: 'sun',
        startsAt,
      })),
    }, 'ana');
    const result = applyCommand(b.state, { type: 'addTimeOff', timeOff: weekly }, { now: NOW, actorId: 'ana' });
    if (!result.ok) throw new Error(result.reason);
    const anaAt = (id: string) => result.state.assignments.some((a) => a.eventId === id && a.memberId === 'ana');
    expect(['dst0', 'dst1', 'dst2'].some(anaAt)).toBe(false);
  });
});

describe('preview', () => {
  it('routes around: the next in line takes it, and I take their turn', () => {
    const g = group();
    expect(seat(g.state, '2026-12-13', 'sound').memberId).toBe('ana');
    const preview = timeOffPreview(timeOffPlan(draft(['2026-12-13']), [g], 'tox'), NOW, VIEWER);
    expect(preview.refused).toEqual([]);
    expect(preview.lines).toEqual([
      expect.objectContaining({ title: 'Sound, Sun, Dec 13', text: 'Ben takes it, and you take Ben’s turn on Dec 20.', kind: 'route' }),
    ]);
    expect(preview.othersAffected).toBe(1);
    expect(savedToast(preview)).toBe('Dates off saved. Routed around 1 Assignment.');
  });

  it('asks for a volunteer: it becomes a Coverage Request', () => {
    const b = buildGroup();
    run(b, { type: 'changeSettings', settings: { timeOffHandling: 'askVolunteer' } }, 'ana');
    const preview = timeOffPreview(timeOffPlan(draft(['2026-12-13']), [group(b.state)], 'tox'), NOW, VIEWER);
    expect(preview.lines).toEqual([
      expect.objectContaining({
        title: 'Sound, Sun, Dec 13',
        text: 'Becomes a Coverage Request (Sunday Team asks for a volunteer).',
        kind: 'coverage',
      }),
    ]);
    expect(savedToast(preview)).toBe('Dates off saved. 1 Coverage Request sent.');
  });

  it('nothing to change on days I am not serving', () => {
    const preview = timeOffPreview(timeOffPlan(draft(['2026-12-06']), [group()], 'tox'), NOW, VIEWER);
    expect(preview.lines).toEqual([]);
    expect(savedToast(preview)).toBe('Dates off saved. We’ll schedule around it.');
  });

  it('reports a Group where the engine refuses', () => {
    const g = group();
    const plan = timeOffPlan(draft(['2026-12-13']), [g], 'tox');
    plan[0].entries[0] = { ...plan[0].entries[0], timeZone: 'Mars/Olympus', repeatEveryWeeks: 1 };
    expect(timeOffPreview(plan, NOW, VIEWER).refused).toEqual([{ groupId: 'g1', groupName: 'Sunday Team', reason: 'invalid' }]);
  });

  it('does not change the loaded state', () => {
    const g = group();
    const before = JSON.stringify(g.state);
    timeOffPreview(timeOffPlan(draft(['2026-12-13']), [g], 'tox'), NOW, VIEWER);
    expect(JSON.stringify(g.state)).toBe(before);
  });
});

describe('"Your Time Off" and the calendar', () => {
  function saved(d: TimeOffDraft, groups: TimeOffGroup[]) {
    return timeOffPlan(d, groups, 'tox').map(({ group: g, entries }) => {
      let state = g.state;
      for (const timeOff of entries) {
        const r = applyCommand(state, { type: 'addTimeOff', timeOff }, { now: NOW, actorId: g.myMemberId });
        if (!r.ok) throw new Error(r.reason);
        state = r.state;
      }
      return { ...g, state };
    });
  }

  it('shows one item per save across Groups, with its scope and note', () => {
    const groups = saved(draft(['2026-12-13'], { note: 'Family trip' }), [group(), group(buildGroup().state, 'cal', 'Other', 'g2')]);
    const items = timeOffItems(groups, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'tox', label: 'Sun, Dec 13', detail: 'All jobs · Sunday Team, Other · Family trip' });
    expect(items[0].entries).toEqual([
      { groupId: 'g1', timeOffId: 'tox-r1' },
      { groupId: 'g2', timeOffId: 'tox-r1' },
    ]);
  });

  it('labels ranges, several days, and repeats', () => {
    const label = (d: TimeOffDraft) => timeOffItems(saved(d, [group()]), NOW)[0].label;
    expect(label(draft(rangeDates('2026-12-13', '2026-12-19')))).toBe('Dec 13 – Dec 19');
    expect(label(draft(['2026-12-13', '2026-12-20', '2026-12-21']))).toBe('3 days from Dec 13');
    expect(label(draft(['2026-12-13'], { repeat: 'weekly' }))).toBe('Sun, Dec 13, repeats weekly');
    expect(label(draft(['2026-12-13'], { repeat: 'biweekly' }))).toBe('Sun, Dec 13, every other week');
    expect(label(draft(['2026-12-13'], { repeat: 'monthly' }))).toBe('Sun, Dec 13, monthly');
    expect(timeOffItems(saved(draft(['2026-12-13'], { scope: ['Sound'] }), [group()]), NOW)[0].detail).toBe('Sound');
  });

  it('leaves out removed and past Time Off', () => {
    const [g] = saved(draft(['2026-12-13']), [group()]);
    const r = applyCommand(g.state, { type: 'removeTimeOff', timeOffId: 'tox-r1' }, { now: NOW, actorId: 'ana' });
    if (!r.ok) throw new Error(r.reason);
    expect(timeOffItems([{ ...g, state: r.state }], NOW)).toEqual([]);
    expect(timeOffItems([g], '2027-01-01T00:00:00.000Z')).toEqual([]);
  });

  it('marks Time Off days on the calendar, repeats included', () => {
    const groups = saved(draft(['2026-12-13'], { repeat: 'biweekly' }), [group()]);
    expect([...timeOffDates(groups, '2026-12-01', '2027-01-15', NOW)]).toEqual(['2026-12-13', '2026-12-27', '2027-01-10']);
  });

  it("dots the days I'm serving", () => {
    const days = servingDates([group()], VIEWER, NOW);
    expect(days.has('2026-11-22')).toBe(true);
    expect(days.has('2026-11-29')).toBe(false);
  });
});

describe('history with reasons and repeats', () => {
  it('describes a Skip Date reason and a repeating Time Off', () => {
    const b = buildGroup();
    run(b, { type: 'addSkipDate', eventId: 'sun@2027-01-03', reason: 'Holiday: Building closed.' }, 'ben');
    run(b, {
      type: 'addTimeOff',
      timeOff: { id: 'w', memberId: 'cal', startsAt: '2026-12-13T06:00:00.000Z', endsAt: '2026-12-14T06:00:00.000Z', repeatEveryWeeks: 1, timeZone: ZONE },
    }, 'cal');
    const ctx = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const texts = b.history.slice(-2).map((h) => describeHistoryEntry(h, ctx).text);
    expect(texts).toEqual([
      'Ben marked Sun, Jan 3 as a day off (Holiday: Building closed). Turns move forward one date.',
      'Cal added Time Off (Dec 13, repeats weekly).',
    ]);
  });
});
