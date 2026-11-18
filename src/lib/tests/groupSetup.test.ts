import { describe, expect, it } from 'vitest';

import { createGroupState, type GroupState, type RepeatPattern } from '../../engine';
import { localTime } from '../../schedule/expandSeries';
import {
  andList,
  choiceLabel,
  COVERAGE_POLICY_CHOICES,
  countRealWorkWarning,
  daysToMs,
  deadlineDays,
  deadlineLabel,
  dayOfMonthHint,
  describeEnd,
  describeRepeat,
  firstUnstaffedResponsibility,
  formatDate,
  formatTime,
  moveItem,
  newId,
  newSeriesForm,
  ordinal,
  outstandingMakeUpTurns,
  parseDate,
  parseTime,
  patternFromForm,
  previewInstants,
  qualificationOptions,
  responsibilityChanges,
  responsibilityViews,
  rotationQueue,
  teamLabel,
  seriesEdit,
  seriesFormFrom,
  seriesViews,
  setupChecklist,
  todayIn,
  upcomingOneOffEvents,
  validateGroupName,
  validateOneOffForm,
  validateResponsibilityForm,
  validateSeriesForm,
  type SeriesForm,
} from '../groupSetup';

const NOW = new Date('2026-11-15T12:00:00.000Z'); // Sunday

const sundays: RepeatPattern = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '09:00',
  timeZone: 'America/Chicago',
  startsOn: '2026-11-15',
};

function sample(): GroupState {
  const state = createGroupState({
    groupId: 'g1',
    primaryResponsibilityId: 'sound',
    members: [
      { id: 'a', name: 'Ana', accountId: 'acc-a', isAdmin: true },
      { id: 'p', name: 'pat' },
      { id: 'z', name: 'Zed', accountId: 'acc-z' },
      { id: 'gone', name: 'Gone', accountId: 'acc-g' },
    ],
    responsibilities: [
      { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true, qualifiedMemberIds: ['z', 'a'] },
      { id: 'greeter', name: 'Greeter', headcount: 2, requiresConfirmation: false, qualifiedMemberIds: [] },
      { id: 'old', name: 'Old', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: ['a'] },
    ],
    eventSeries: [
      { id: 's1', name: 'Sundays', responsibilityIds: ['sound', 'old'], repeat: sundays },
      { id: 's2', name: 'Gone series', responsibilityIds: ['sound'] },
    ],
    events: [
      { id: 'o1', seriesId: null, startsAt: '2026-12-05T00:30:00.000Z', responsibilityIds: ['greeter'] },
      { id: 'o0', seriesId: null, startsAt: '2026-11-01T00:30:00.000Z', responsibilityIds: ['sound'] },
      { id: 'e1', seriesId: 's1', startsAt: '2026-11-22T15:00:00.000Z' },
    ],
  });
  return {
    ...state,
    members: state.members.map((m) => (m.id === 'gone' ? { ...m, leftAt: '2026-11-01T00:00:00.000Z' } : m)),
    responsibilities: state.responsibilities.map((r) => (r.id === 'old' ? { ...r, removedAt: '2026-11-01T00:00:00.000Z' } : r)),
    eventSeries: state.eventSeries.map((s) => (s.id === 's2' ? { ...s, removedAt: '2026-11-01T00:00:00.000Z' } : s)),
  };
}

describe('helpers', () => {
  it('moveItem moves within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
  });
  it('newId avoids taken ids', () => {
    const values = [0, 0, 0.5];
    const random = () => values.shift() ?? 0.9;
    expect(newId('r', ['r-000000'], random)).toBe(`r-${Math.floor(0.5 * 36 ** 6).toString(36)}`);
  });
  it('andList', () => {
    expect(andList([])).toBe('');
    expect(andList(['A'])).toBe('A');
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('Responsibilities', () => {
  it("names a Responsibility's team and its size", () => {
    expect(teamLabel('Sound', 6)).toBe('Sound team · 6 people');
    expect(teamLabel('Sound', 1)).toBe('Sound team · 1 person');
    expect(teamLabel('Sound', 0)).toBe('Sound team · 0 people');
  });

  it('lists active ones in fill order with a summary', () => {
    const views = responsibilityViews(sample());
    expect(views.map((v) => v.id)).toEqual(['sound', 'greeter']);
    expect(views[0]).toMatchObject({ isPrimary: true, qualifiedCount: 2, summary: 'Sound team · 2 people · 1 per Event · Needs confirmation' });
    expect(views[1].summary).toBe('Greeter team · 0 people · 2 per Event · No confirmation');
  });

  it('shows the Rotation queue in order and qualification options by name', () => {
    const state = sample();
    expect(rotationQueue(state, 'sound').map((q) => q.name)).toEqual(['Zed', 'Ana']);
    expect(qualificationOptions(state, 'sound')).toEqual([
      { memberId: 'a', name: 'Ana', qualified: true },
      { memberId: 'p', name: 'pat', qualified: false },
      { memberId: 'z', name: 'Zed', qualified: true },
    ]);
    expect(qualificationOptions(state, null).every((o) => !o.qualified)).toBe(true);
  });

  it('validates the form', () => {
    expect(validateResponsibilityForm({ name: ' Host ', headcount: '2', requiresConfirmation: true })).toEqual({
      ok: true,
      value: { name: 'Host', headcount: 2, requiresConfirmation: true },
    });
    const bad = validateResponsibilityForm({ name: ' ', headcount: '0', requiresConfirmation: false });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['headcount', 'name']);
    expect(validateResponsibilityForm({ name: 'x', headcount: '1.5', requiresConfirmation: false }).ok).toBe(false);
    expect(validateResponsibilityForm({ name: 'x', headcount: '51', requiresConfirmation: false }).ok).toBe(false);
    const dup = validateResponsibilityForm({ name: 'sound', headcount: '1', requiresConfirmation: false }, ['Sound']);
    expect(dup.ok ? null : dup.errors.name).toMatch(/already/);
  });

  it('sends only changed fields', () => {
    const current = { name: 'Sound', headcount: 1, requiresConfirmation: true };
    expect(responsibilityChanges(current, current)).toBeNull();
    expect(responsibilityChanges(current, { ...current, headcount: 3 })).toEqual({ headcount: 3 });
  });

  it('counts outstanding Make-up Turns', () => {
    const state: GroupState = {
      ...sample(),
      makeUpTurns: [
        { id: 'm1', responsibilityId: 'sound', debtorId: 'a', creditorId: 'z', coverAssignmentId: 'x', createdAt: '', status: 'outstanding', closedAt: null, closedReason: null },
        { id: 'm2', responsibilityId: 'greeter', debtorId: 'a', creditorId: 'z', coverAssignmentId: 'y', createdAt: '', status: 'paid', closedAt: null, closedReason: null },
      ],
    };
    expect(outstandingMakeUpTurns(state)).toBe(1);
    expect(outstandingMakeUpTurns(state, 'greeter')).toBe(0);
    expect(countRealWorkWarning(state)).toMatch(/1 outstanding Make-up Turn will be cancelled/);
    expect(countRealWorkWarning(sample())).toMatch(/no outstanding Make-up Turns/);
  });
});

describe('times and dates', () => {
  it.each([
    ['9', '09:00'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['930', '09:30'],
    ['9am', '09:00'],
    ['9:30 PM', '21:30'],
    ['12 am', '00:00'],
    ['12pm', '12:00'],
    ['21:00', '21:00'],
    ['0:05', '00:05'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
  ])('parseTime(%s) = %s', (text, expected) => expect(parseTime(text)).toBe(expected));

  it.each(['', '25:00', '13pm', '9:60', 'nine', '0am'])('parseTime(%s) is null', (text) => expect(parseTime(text)).toBeNull());

  it('formats times', () => {
    expect(formatTime('09:00')).toBe('9:00 AM');
    expect(formatTime('00:15')).toBe('12:15 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('21:30')).toBe('9:30 PM');
  });

  it('parses and formats dates', () => {
    expect(parseDate('2026-11-22')).toBe('2026-11-22');
    expect(parseDate('2026/2/3')).toBe('2026-02-03');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('Nov 22')).toBeNull();
    expect(formatDate('2026-11-22')).toBe('Sun, Nov 22, 2026');
  });

  it('knows today in a time zone', () => {
    expect(todayIn('America/Chicago', new Date('2026-11-16T03:00:00Z'))).toBe('2026-11-15');
    expect(todayIn('Asia/Tokyo', new Date('2026-11-15T16:00:00Z'))).toBe('2026-11-16');
    expect(todayIn('Not/AZone', new Date('2026-11-15T16:00:00Z'))).toBe('2026-11-15');
  });
});

describe('Event Series form', () => {
  const form = (f: Partial<SeriesForm> = {}): SeriesForm => ({ ...newSeriesForm(sample(), 'America/Chicago', NOW), name: 'Sundays', ...f });

  it('starts weekly on today, at 9:00 AM, in the Group time zone, with every Responsibility', () => {
    expect(newSeriesForm(sample(), 'America/Chicago', NOW)).toEqual({
      name: '',
      frequency: 'weekly',
      intervalWeeks: '3',
      intervalDays: '2',
      daysOfWeek: [0],
      monthlyBy: 'weekday',
      weekOfMonth: 1,
      dayOfMonth: '15',
      intervalMonths: '1',
      time: '9:00 AM',
      timeZone: 'America/Chicago',
      startsOn: '2026-11-15',
      ends: 'never',
      endsOn: '',
      endsAfter: '10',
      responsibilityIds: ['sound', 'greeter'],
    });
  });

  describe('the newer repeat options', () => {
    const repeatOf = (f: Partial<SeriesForm>) => {
      const result = validateSeriesForm(form(f), ['sound']);
      return result.ok ? result.value.repeat : result.errors;
    };

    it('every N days has no weekdays', () => {
      expect(repeatOf({ frequency: 'daily', intervalDays: '10' })).toEqual({
        ...sundays,
        frequency: 'daily',
        intervalDays: 10,
        daysOfWeek: [],
      });
      expect(repeatOf({ frequency: 'daily', intervalDays: '0' })).toEqual({ interval: 'Enter a number of days from 1 to 365.' });
      expect(repeatOf({ frequency: 'daily', intervalDays: '1', daysOfWeek: [] })).toMatchObject({ intervalDays: 1 });
    });

    it('monthly on a date, every N months', () => {
      expect(repeatOf({ frequency: 'monthly', monthlyBy: 'date', dayOfMonth: '31', intervalMonths: '3' })).toEqual({
        ...sundays,
        frequency: 'monthly',
        daysOfWeek: [],
        dayOfMonth: 31,
        intervalMonths: 3,
      });
      expect(repeatOf({ frequency: 'monthly', monthlyBy: 'date', dayOfMonth: '32' })).toEqual({
        dayOfMonth: 'Enter a day of the month from 1 to 31.',
      });
      // Every 1 month is stored as plain monthly, exactly like patterns made before.
      expect(repeatOf({ frequency: 'monthly', weekOfMonth: 1, intervalMonths: '1' })).toStrictEqual({
        ...sundays,
        frequency: 'monthly',
        weekOfMonth: 1,
      });
      expect(repeatOf({ frequency: 'monthly', intervalMonths: '13' })).toEqual({ interval: 'Enter a number of months from 1 to 12.' });
    });

    it('ends on a date or after a number of Events', () => {
      expect(repeatOf({ ends: 'onDate', endsOn: '2027-06-30' })).toEqual({ ...sundays, endsOn: '2027-06-30' });
      expect(repeatOf({ ends: 'onDate', endsOn: '' })).toEqual({ endsOn: 'Enter a date like 2027-06-30.' });
      expect(repeatOf({ ends: 'onDate', endsOn: '2026-11-01' })).toEqual({ endsOn: 'The end date must be on or after the start date.' });
      expect(repeatOf({ ends: 'afterCount', endsAfter: '6' })).toEqual({ ...sundays, endsAfter: 6 });
      expect(repeatOf({ ends: 'afterCount', endsAfter: '0' })).toEqual({ endsAfter: 'Enter a number of Events from 1 to 500.' });
      // A hidden end field is ignored.
      expect(repeatOf({ ends: 'never', endsOn: 'junk', endsAfter: 'junk' })).toStrictEqual(sundays);
    });

    it('fills the form back from a stored pattern', () => {
      const state = sample();
      const repeat: RepeatPattern = { ...sundays, frequency: 'monthly', daysOfWeek: [], dayOfMonth: 15, intervalMonths: 3, endsOn: '2027-06-30' };
      const f = seriesFormFrom({ name: 'Q', responsibilityIds: ['sound'], repeat }, state, 'America/Chicago', NOW);
      expect(f).toMatchObject({ monthlyBy: 'date', dayOfMonth: '15', intervalMonths: '3', ends: 'onDate', endsOn: '2027-06-30', daysOfWeek: [0] });
      const v = validateSeriesForm(f, ['sound']);
      expect(v.ok && v.value.repeat).toEqual(repeat);
      const daily: RepeatPattern = { ...sundays, frequency: 'daily', intervalDays: 10, daysOfWeek: [], endsAfter: 6 };
      const g = seriesFormFrom({ name: 'D', responsibilityIds: ['sound'], repeat: daily }, state, 'America/Chicago', NOW);
      expect(g).toMatchObject({ frequency: 'daily', intervalDays: '10', ends: 'afterCount', endsAfter: '6' });
      expect(validateSeriesForm(g, ['sound'])).toMatchObject({ ok: true, value: { repeat: daily } });
    });

    it('describes them in plain language', () => {
      expect(describeRepeat({ ...sundays, frequency: 'daily', intervalDays: 10, daysOfWeek: [] })).toBe('Every 10 days at 9:00 AM');
      expect(describeRepeat({ ...sundays, frequency: 'daily', intervalDays: 1, daysOfWeek: [], startTime: '19:00' })).toBe('Every day at 7:00 PM');
      expect(describeRepeat({ ...sundays, frequency: 'monthly', daysOfWeek: [], dayOfMonth: 15 })).toBe('Monthly on the 15th at 9:00 AM');
      expect(describeRepeat({ ...sundays, frequency: 'monthly', daysOfWeek: [], dayOfMonth: 15, intervalMonths: 3, endsOn: '2026-12-31' })).toBe(
        'Every 3 months on the 15th at 9:00 AM, until Dec 31',
      );
      expect(describeRepeat({ ...sundays, frequency: 'monthly', daysOfWeek: [], dayOfMonth: 1, intervalMonths: 3, endsOn: '2027-06-30' })).toBe(
        'Every 3 months on the 1st at 9:00 AM, until Jun 30, 2027',
      );
      expect(describeRepeat({ ...sundays, frequency: 'monthly', weekOfMonth: 1, daysOfWeek: [2], intervalMonths: 3 })).toBe(
        'Every 3 months on the 1st Tuesday at 9:00 AM',
      );
      expect(describeRepeat({ ...sundays, frequency: 'monthly', weekOfMonth: -1, intervalMonths: 2 })).toBe(
        'Every 2 months on the last Sunday at 9:00 AM',
      );
      expect(describeRepeat({ ...sundays, endsAfter: 6 })).toBe('Every Sunday at 9:00 AM, 6 times');
      expect(describeRepeat({ ...sundays, endsAfter: 1 })).toBe('Every Sunday at 9:00 AM, once');
    });

    it('says when the last Event is, and explains short months', () => {
      expect(describeEnd(sundays)).toBeNull();
      expect(describeEnd({ ...sundays, endsAfter: 6 })).toBe('The last of 6 Events is on Sun, Dec 20, 2026.');
      expect(describeEnd({ ...sundays, endsOn: '2026-12-10' })).toBe('The last Event is on Sun, Dec 6, 2026.');
      expect(dayOfMonthHint('15')).toBe('From 1 to 31. Months without that day use their last day.');
      expect(dayOfMonthHint('31')).toBe('Months without a 31st use their last day, like Apr 30 or Feb 28.');
      expect(dayOfMonthHint('30')).toBe('Months without a 30th use their last day, like Feb 28.');
      expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
        '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st',
      ]);
    });

    it('previews an every-N-months pattern and stops at the end', () => {
      const p = validateSeriesForm(form({ frequency: 'monthly', monthlyBy: 'date', dayOfMonth: '31', ends: 'afterCount', endsAfter: '3' }), ['sound']);
      const got = p.ok ? previewInstants(p.value.repeat, NOW, 4) : [];
      expect(got.map((i) => i.slice(0, 10))).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    });

    it('changing only the end moves Events', () => {
      const current = { name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays };
      expect(seriesEdit(current, { ...current, repeat: { ...sundays, endsAfter: 4 } })?.movesEvents).toBe(true);
    });
  });

  it('turns a valid form into a repeat pattern', () => {
    const result = validateSeriesForm(form({ daysOfWeek: [4, 2, 2], time: '6:30 pm' }), ['sound', 'greeter']);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Sundays',
        responsibilityIds: ['sound', 'greeter'],
        repeat: { ...sundays, daysOfWeek: [2, 4], startTime: '18:30' },
      },
    });
  });

  it('sets intervalWeeks only for custom and weekOfMonth only for monthly', () => {
    const custom = validateSeriesForm(form({ frequency: 'custom', intervalWeeks: '3' }), ['sound']);
    expect(custom.ok && custom.value.repeat).toMatchObject({ intervalWeeks: 3, weekOfMonth: null });
    const monthly = validateSeriesForm(form({ frequency: 'monthly', weekOfMonth: -1 }), ['sound']);
    expect(monthly.ok && monthly.value.repeat).toMatchObject({ intervalWeeks: null, weekOfMonth: -1 });
  });

  it('reports every problem', () => {
    const result = validateSeriesForm(
      form({ name: '', daysOfWeek: [], time: 'soon', startsOn: 'tomorrow', frequency: 'custom', intervalWeeks: '0', timeZone: 'Nowhere', responsibilityIds: ['old'] }),
      ['sound'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['days', 'interval', 'name', 'responsibilities', 'startsOn', 'time', 'timeZone']);
    }
  });

  it('gives a pattern for the preview even before a name or Responsibilities are picked', () => {
    expect(patternFromForm(form({ name: '', responsibilityIds: [] }))).toEqual(sundays);
    expect(patternFromForm(form({ time: '' }))).toBeNull();
  });

  it('previews the next dates at local time', () => {
    const got = previewInstants(sundays, NOW, 4);
    expect(got).toHaveLength(4);
    expect(got[0]).toBe('2026-11-15T15:00:00.000Z');
    expect(new Set(got.map((i) => localTime(i, 'America/Chicago')))).toEqual(new Set(['09:00']));
  });

  it('fills the form from an existing series (dropping removed Responsibilities)', () => {
    const state = sample();
    const series = state.eventSeries[0];
    const f = seriesFormFrom(series, state, 'America/Chicago', NOW);
    expect(f).toMatchObject({ name: 'Sundays', time: '9:00 AM', daysOfWeek: [0], responsibilityIds: ['sound'], startsOn: '2026-11-15' });
    const v = validateSeriesForm(f, ['sound', 'greeter']);
    expect(v.ok && v.value.repeat).toEqual(sundays);
  });

  it('an edit sends only changes, and says when Events move', () => {
    const current = { name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays };
    expect(seriesEdit(current, { ...current })).toBeNull();
    expect(seriesEdit(current, { ...current, name: 'Sun AM' })).toEqual({ changes: { name: 'Sun AM' }, movesEvents: false });
    expect(seriesEdit(current, { ...current, responsibilityIds: ['sound', 'greeter'] })).toEqual({
      changes: { responsibilityIds: ['sound', 'greeter'] },
      movesEvents: false,
    });
    const moved = seriesEdit(current, { ...current, repeat: { ...sundays, startTime: '10:00' } });
    expect(moved).toEqual({ changes: { repeat: { ...sundays, startTime: '10:00' } }, movesEvents: true });
  });

  it('describes patterns in words', () => {
    expect(describeRepeat(sundays)).toBe('Every Sunday at 9:00 AM');
    expect(describeRepeat({ ...sundays, frequency: 'biweekly', daysOfWeek: [2, 4], startTime: '18:30' })).toBe(
      'Every other Tue and Thu at 6:30 PM',
    );
    expect(describeRepeat({ ...sundays, frequency: 'custom', intervalWeeks: 3 })).toBe('Every 3 weeks on Sunday at 9:00 AM');
    expect(describeRepeat({ ...sundays, frequency: 'monthly', weekOfMonth: -1 })).toBe('Last Sunday of the month at 9:00 AM');
    expect(describeRepeat({ ...sundays, frequency: 'monthly', weekOfMonth: 1, daysOfWeek: [0, 3] })).toBe(
      '1st Sun and Wed of the month at 9:00 AM',
    );
  });

  it('lists active series', () => {
    expect(seriesViews(sample(), 'America/Chicago')).toEqual([
      { id: 's1', name: 'Sundays', description: 'Every Sunday at 9:00 AM', responsibilityNames: ['Sound'] },
    ]);
    expect(seriesViews(sample(), 'Europe/London')[0].description).toBe('Every Sunday at 9:00 AM (America/Chicago)');
  });
});

describe('one-off Events', () => {
  it('validates and converts local date and time to an instant', () => {
    const result = validateOneOffForm({ date: '2026-12-04', time: '6:30 PM', responsibilityIds: ['greeter'] }, 'America/Chicago', NOW, [
      'sound',
      'greeter',
    ]);
    expect(result).toEqual({ ok: true, value: { startsAt: '2026-12-05T00:30:00.000Z', responsibilityIds: ['greeter'] } });
  });

  it('refuses the past, bad input and no Responsibilities', () => {
    const past = validateOneOffForm({ date: '2026-11-15', time: '5:00', responsibilityIds: ['sound'] }, 'America/Chicago', NOW, ['sound']);
    expect(past.ok ? null : past.errors.date).toMatch(/passed/);
    const bad = validateOneOffForm({ date: 'x', time: 'y', responsibilityIds: [] }, 'America/Chicago', NOW, ['sound']);
    expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(['date', 'responsibilities', 'time']);
  });

  it('lists upcoming one-offs only', () => {
    expect(upcomingOneOffEvents(sample(), NOW)).toEqual([
      { id: 'o1', startsAt: '2026-12-05T00:30:00.000Z', responsibilityNames: ['Greeter'] },
    ]);
  });
});

describe('settings', () => {
  it('converts the replacement deadline', () => {
    expect(deadlineDays(daysToMs(3))).toBe(3);
    expect(deadlineLabel(daysToMs(3))).toBe('3 days before');
    expect(deadlineLabel(daysToMs(1))).toBe('1 day before');
    expect(deadlineLabel(0)).toBe('On the day');
  });
  it('labels choices with the prototype wording', () => {
    expect(choiceLabel(COVERAGE_POLICY_CHOICES, 'countRealWork')).toBe('Count Real Work');
  });
  it('validates the group name', () => {
    expect(validateGroupName('  ')).toMatch(/name/);
    expect(validateGroupName('x'.repeat(81))).toMatch(/80/);
    expect(validateGroupName('Crew')).toBeNull();
  });
});

describe('setup checklist', () => {
  const empty = createGroupState({ groupId: 'g', members: [{ id: 'a', name: 'Ana', accountId: 'acc', isAdmin: true }], responsibilities: [] });

  it('shows everything to do for a new Group', () => {
    const list = setupChecklist(empty);
    expect(list.show).toBe(true);
    expect(list.items.map((i) => [i.key, i.done])).toEqual([
      ['responsibilities', false],
      ['qualified', false],
      ['series', false],
      ['invite', false],
    ]);
  });

  it('ticks items off as they are done and disappears once there are Responsibilities and an Event Series', () => {
    const state = sample();
    const noSeries = { ...state, eventSeries: [] };
    const list = setupChecklist(noSeries);
    expect(list.show).toBe(true);
    expect(list.items.map((i) => i.done)).toEqual([true, false, false, true]); // Greeter has nobody yet
    expect(setupChecklist(state).show).toBe(false);
  });

  it('leads "Choose who\'s Qualified" to the first Responsibility with nobody Qualified', () => {
    expect(firstUnstaffedResponsibility(sample())).toBe('greeter');
    expect(firstUnstaffedResponsibility(empty)).toBeNull();
  });
});
