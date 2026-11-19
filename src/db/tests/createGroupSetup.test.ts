/**
 * Simplify ticket 03, end to end through the real server path (group-command handler on the
 * Postgres schema in PGlite): the 3-screen setup creates the Group with its Jobs, "Who's in?"
 * adds typed names as Placeholder Members, and the schedule is already filled, rotating fairly
 * in join order with one person per turn and no confirmation step.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { assignmentStatus } from '../../engine';
import { createGroupRequest, newJobDraft, placeholderCommands, type JobDraft } from '../../lib/groupCreate';
import { stateFromRows } from '../groupRows';
import { handleGroupCommand, type HandlerContext } from '../handleGroupCommand';
import type { GroupCommandRequest, GroupCommandResponse } from '../protocol';
import { NOW } from './fixtures';
import { createTestDb, uuid, type TestDb } from './pglite';

const ANA = uuid(31);
let t: TestDb;
let nextUuid = 5000;

const context: HandlerContext = { accountId: ANA, now: () => NOW, newId: () => uuid(nextUuid++) };
const send = (request: GroupCommandRequest) => handleGroupCommand(t.store, request, context);

function expectOk(response: GroupCommandResponse) {
  if (!response.ok) throw new Error(`Expected ok, got ${response.reason}: ${response.message}`);
  return response;
}

beforeAll(async () => {
  t = await createTestDb();
  await t.createAccount(ANA);
});

describe('3-screen group setup', () => {
  it('creates the Group with its Jobs, adds typed names, and fills the schedule', async () => {
    const now = new Date(NOW);
    const today = '2026-11-30';
    const greeter: JobDraft = { ...newJobDraft(today), name: 'Greeter' };
    const coffee: JobDraft = {
      ...newJobDraft(today),
      name: 'Coffee',
      repeat: { kind: 'month', weekday: 0, nth: 1, date: today },
      time: '09:30',
    };
    const potluck: JobDraft = {
      ...newJobDraft(today),
      name: 'Potluck',
      repeat: { kind: 'once', weekday: 0, nth: 1, date: '2026-12-12' },
      time: '18:00',
      type: 'headcount',
    };
    const blank = newJobDraft(today);

    // Screens 1 and 2: name, time zone and Jobs → one createGroup request.
    const request = createGroupRequest({
      name: '  Welcome team ',
      memberName: 'Ana',
      timeZone: 'America/Chicago',
      jobs: [greeter, blank, coffee, potluck],
      now,
    });
    const created = expectOk(await send(request));
    const { groupId } = created;

    // Screen 3: typed names become Placeholder Members who do every Job.
    const jobIds = request.responsibilities!.map((r) => r.id);
    for (const command of placeholderCommands(['Ben', 'Cal'], jobIds)) {
      expectOk(await send({ action: 'command', groupId, command }));
    }

    const loaded = await t.store.load(groupId);
    const state = stateFromRows(loaded!.rows);
    const group = await t.db.query<{ name: string; time_zone: string }>(
      'select name, time_zone from public.groups where id = $1',
      [groupId],
    );
    expect(group.rows[0]).toEqual({ name: 'Welcome team', time_zone: 'America/Chicago' });

    // Members: Ana (Admin, signed in) then Ben and Cal (Placeholders), in join order.
    expect(state.members.map((m) => [m.name, m.isAdmin, m.accountId === null])).toEqual([
      ['Ana', true, false],
      ['Ben', false, true],
      ['Cal', false, true],
    ]);
    const [ana, ben, cal] = state.members.map((m) => m.id);

    // Defaults: one Job = one Responsibility + one series; one person per turn, no
    // confirmation, everyone does every Job, join-order rotation.
    expect(state.responsibilities.map((r) => [r.name, r.kind, r.headcount, r.requiresConfirmation])).toEqual([
      ['Greeter', 'turns', 1, false],
      ['Coffee', 'turns', 1, false],
      ['Potluck', 'headcount', 1, false],
    ]);
    expect(state.eventSeries.map((s) => [s.name, s.repeat?.frequency ?? null])).toEqual([
      ['Greeter', 'weekly'],
      ['Coffee', 'monthly'],
      ['Potluck', null],
    ]);
    // Take-turns Jobs rotate everyone; the headcount Job (Potluck) has no turns.
    expect(state.rotations.map((r) => r.queue)).toEqual([[ana, ben, cal], [ana, ben, cal], []]);
    expect(state.primaryResponsibilityId).toBeNull();
    expect(state.settings).toMatchObject({ coveragePolicy: 'payItBack', timeOffHandling: 'routeAround', allowDoubling: false });

    // The schedule is filled: every date of every Job has its one person.
    const greeterId = state.responsibilities[0].id;
    const greeterTurns = state.assignments
      .filter((a) => a.responsibilityId === greeterId)
      .map((a) => ({ a, startsAt: state.events.find((e) => e.id === a.eventId)!.startsAt }))
      .sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
    expect(greeterTurns.length).toBeGreaterThan(4);
    // Every Sunday at 10:00 in Chicago (16:00 UTC in winter).
    expect(greeterTurns[0].startsAt).toBe('2026-12-06T16:00:00.000Z');
    // Coffee (1st Sunday, 9:30) and Greeter share Dec 6 and Jan 3. No one is booked twice on a
    // day (ADR 0005), so Greeter routes around whoever has Coffee those days.
    expect(greeterTurns.slice(0, 6).map((x) => x.a.memberId)).toEqual([ben, ana, cal, ana, cal, ben]);
    const booked = new Set<string>();
    for (const a of state.assignments) {
      const startsAt = state.events.find((e) => e.id === a.eventId)!.startsAt;
      const day = new Date(startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      expect(booked.has(`${day}:${a.memberId}`), `${day} double booked`).toBe(false);
      booked.add(`${day}:${a.memberId}`);
    }
    for (const { a, startsAt } of greeterTurns) {
      expect(a.memberId).not.toBeNull();
      expect(a.confirmation).toBe('notRequired');
      expect(assignmentStatus(a, startsAt, NOW)).toBe('scheduled');
    }

    const coffeeEvents = state.events.filter((e) => e.seriesId === state.eventSeries[1].id).map((e) => e.startsAt).sort();
    // 1st Sunday monthly at 9:30.
    expect(coffeeEvents[0]).toBe('2026-12-06T15:30:00.000Z');
    expect(coffeeEvents[1]).toBe('2027-01-03T15:30:00.000Z');

    // The one-off headcount date: nobody has a turn; everyone is asked "Coming?".
    const potluckEvents = state.events.filter((e) => e.seriesId === state.eventSeries[2].id);
    expect(potluckEvents.map((e) => e.startsAt)).toEqual(['2026-12-13T00:00:00.000Z']);
    expect(state.assignments.filter((a) => a.eventId === potluckEvents[0].id)).toHaveLength(0);

    // Ana says Yes, then answers No for Ben (a Stand-in); the answers are stored and read back.
    const potluckDate = { eventId: potluckEvents[0].id, responsibilityId: state.responsibilities[2].id };
    for (const [memberId, answer] of [[ana, 'yes'], [ben, 'no']] as const) {
      expectOk(await send({ action: 'command', groupId, command: { type: 'answerHeadcount', ...potluckDate, memberId, answer } }));
    }
    const after = stateFromRows((await t.store.load(groupId))!.rows);
    expect(after.headcountAnswers.map((a) => [a.memberId, a.answer, a.answeredBy])).toEqual([
      [ana, 'yes', ana],
      [ben, 'no', ana],
    ]);
    // Answering again changes it in place; the schedule is untouched.
    expectOk(await send({ action: 'command', groupId, command: { type: 'answerHeadcount', ...potluckDate, memberId: ben, answer: 'yes' } }));
    const again = stateFromRows((await t.store.load(groupId))!.rows);
    expect(again.headcountAnswers.map((a) => [a.memberId, a.answer])).toEqual([
      [ana, 'yes'],
      [ben, 'yes'],
    ]);
    expect(again.assignments).toEqual(after.assignments);
  });
});
