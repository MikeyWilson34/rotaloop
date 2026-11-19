import { describe, expect, it } from 'vitest';

import {
  addPersonName,
  checkJobs,
  createGroupRequest,
  jobPattern,
  jobTimeText,
  newJobDraft,
  placeholderCommands,
  repeatText,
  SIMPLE_GROUP_SETTINGS,
  timeFromParts,
  timeParts,
  type JobDraft,
} from '../groupCreate';

const TODAY = '2026-11-19'; // a Thursday
const NOW = new Date('2026-11-19T18:00:00Z');
const job = (patch: Partial<JobDraft>): JobDraft => ({ ...newJobDraft(TODAY), ...patch });

describe('newJobDraft', () => {
  it('starts as every Sunday at 10:00am, take turns, one-off a week out', () => {
    const d = newJobDraft(TODAY);
    expect(d).toEqual({ name: '', repeat: { kind: 'week', weekday: 0, nth: 1, date: '2026-11-26' }, time: '10:00', type: 'turns' });
    expect(`${repeatText(d.repeat)} · ${jobTimeText(d.time)}`).toBe('every Sunday · 10:00am');
  });
});

describe('repeatText', () => {
  it('reads as part of a sentence', () => {
    const r = newJobDraft(TODAY).repeat;
    expect(repeatText({ ...r, kind: '2week', weekday: 3 })).toBe('every other Wednesday');
    expect(repeatText({ ...r, kind: 'month', nth: 2 })).toBe('2nd Sunday monthly');
    expect(repeatText({ ...r, kind: 'month', nth: -1, weekday: 6 })).toBe('last Saturday monthly');
    expect(repeatText({ ...r, kind: 'once', date: '2026-12-06' })).toBe('once, Dec 6');
  });
});

describe('time parts', () => {
  it('round-trips through the picker', () => {
    expect(timeParts('00:00')).toEqual({ hour: 12, minute: '00', ampm: 'am' });
    expect(timeParts('12:15')).toEqual({ hour: 12, minute: '15', ampm: 'pm' });
    expect(timeParts('18:30')).toEqual({ hour: 6, minute: '30', ampm: 'pm' });
    for (const t of ['00:00', '09:45', '12:00', '12:15', '18:30', '23:45']) expect(timeFromParts(timeParts(t))).toBe(t);
    expect(jobTimeText('18:30')).toBe('6:30pm');
    expect(jobTimeText('00:15')).toBe('12:15am');
  });
});

describe('checkJobs', () => {
  it('needs at least one named Job', () => {
    expect(checkJobs([job({}), job({ name: '  ' })], 'UTC', NOW)).toMatchObject({ ok: false });
    expect(checkJobs([job({ name: 'Greeter' }), job({})], 'UTC', NOW)).toEqual({ ok: true });
  });
  it('refuses duplicate names and past one-off dates', () => {
    expect(checkJobs([job({ name: 'Greeter' }), job({ name: 'greeter ' })], 'UTC', NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining('two jobs'),
    });
    const past = job({ name: 'Picnic', repeat: { kind: 'once', weekday: 0, nth: 1, date: '2026-11-19' }, time: '09:00' });
    expect(checkJobs([past], 'UTC', NOW)).toMatchObject({ ok: false, message: expect.stringContaining('Picnic') });
    expect(checkJobs([{ ...past, time: '20:00' }], 'UTC', NOW)).toEqual({ ok: true });
  });
});

describe('jobPattern', () => {
  it('maps each repeat choice to the engine pattern', () => {
    const tz = 'America/Chicago';
    expect(jobPattern(job({}), tz, TODAY)).toEqual({
      frequency: 'weekly',
      intervalWeeks: null,
      daysOfWeek: [0],
      weekOfMonth: null,
      startTime: '10:00',
      timeZone: tz,
      startsOn: TODAY,
    });
    // Every 2 weeks counts from the first matching day, so it is the first date.
    expect(jobPattern(job({ repeat: { kind: '2week', weekday: 0, nth: 1, date: TODAY } }), tz, TODAY)).toMatchObject({
      frequency: 'biweekly',
      startsOn: '2026-11-22',
    });
    expect(jobPattern(job({ repeat: { kind: '2week', weekday: 4, nth: 1, date: TODAY } }), tz, TODAY)).toMatchObject({
      startsOn: TODAY,
    });
    expect(jobPattern(job({ repeat: { kind: 'month', weekday: 2, nth: -1, date: TODAY } }), tz, TODAY)).toMatchObject({
      frequency: 'monthly',
      weekOfMonth: -1,
      daysOfWeek: [2],
    });
    expect(jobPattern(job({ repeat: { kind: 'once', weekday: 0, nth: 1, date: '2026-12-01' } }), tz, TODAY)).toBeNull();
  });
});

describe('createGroupRequest', () => {
  it('writes the defaults and one Responsibility + series per named Job', () => {
    let n = 0;
    const request = createGroupRequest({
      name: ' Coffee team ',
      memberName: ' Ana ',
      timeZone: 'Not/AZone',
      jobs: [
        job({ name: ' Greeter ' }),
        job({}),
        job({ name: 'Picnic', type: 'headcount', repeat: { kind: 'once', weekday: 0, nth: 1, date: '2026-12-05' }, time: '12:00' }),
      ],
      now: NOW,
      random: () => (n++ % 7) / 7,
    });
    expect(request).toMatchObject({ action: 'createGroup', name: 'Coffee team', memberName: 'Ana', timeZone: 'UTC' });
    expect(request.settings).toEqual(SIMPLE_GROUP_SETTINGS);
    expect(request.primaryResponsibilityId).toBeNull();
    const [greeter, picnic] = request.responsibilities!;
    expect(greeter).toMatchObject({ name: 'Greeter', headcount: 1, requiresConfirmation: false });
    // Headcount Jobs are take-turns Jobs until the data model has a Job type (ticket 09).
    expect(picnic).toMatchObject({ name: 'Picnic', headcount: 1, requiresConfirmation: false });
    expect(request.creatorQualifiedFor).toEqual([greeter.id, picnic.id]);
    expect(request.eventSeries!.map((s) => [s.name, s.responsibilityIds, s.repeat?.frequency ?? null])).toEqual([
      ['Greeter', [greeter.id], 'weekly'],
      ['Picnic', [picnic.id], null],
    ]);
    expect(request.events).toEqual([
      { id: expect.stringContaining('@20261205T1200Z'), seriesId: request.eventSeries![1].id, startsAt: '2026-12-05T12:00:00.000Z' },
    ]);
    const ids = [...request.responsibilities!.map((r) => r.id), ...request.eventSeries!.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Who's in?", () => {
  it('adds typed names once each', () => {
    let people: string[] = [];
    const add = (typed: string) => {
      const result = addPersonName(people, typed, 'Ana Smith');
      if (result.ok) people = result.people;
      return result;
    };
    expect(add('  Ben   Jones ')).toMatchObject({ ok: true });
    expect(add('ben jones')).toMatchObject({ ok: false, message: 'Ben Jones is already on the list.' });
    expect(add('ana smith')).toMatchObject({ ok: false });
    expect(add('   ')).toMatchObject({ ok: false });
    expect(people).toEqual(['Ben Jones']);
  });
  it('makes Placeholder Members who do every Job', () => {
    expect(placeholderCommands(['Ben'], ['r-1', 'r-2'])).toEqual([
      { type: 'addMember', member: { name: 'Ben' }, qualifiedFor: ['r-1', 'r-2'] },
    ]);
  });
});
