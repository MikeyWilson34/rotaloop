/**
 * Simplify ticket 09 in the database (20261124000000_headcount_jobs.sql): `responsibilities.kind`
 * and `headcount_answers`, read back by group_state_rows, written by apply_group_command_result,
 * readable by the Group's Members only, and safe with a group-command from before the migration.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createGroupState, type Command, type CommandResult, type GroupState } from '../../engine';
import { rowsFromState, stateFromRows } from '../groupRows';
import { parseClientCommand, parseRequest } from '../parseRequest';
import { run, week } from './fixtures';
import { createTestDb, uuid, type TestDb } from './pglite';

type Ok = Extract<CommandResult, { ok: true }>;

const ANA = uuid(1);
const OUT = uuid(4);

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await t.createAccount(ANA, 'Ana');
  await t.createAccount(OUT, 'Out');
});

/** ana (on the app), ben and cal (Stand-ins). Sound takes turns; Coffee is a headcount. */
function headcountGroup(groupId: string): GroupState {
  const names = ['ana', 'ben', 'cal'];
  return createGroupState({
    groupId,
    members: names.map((id) => ({ id, name: id.toUpperCase(), accountId: id === 'ana' ? ANA : null })),
    responsibilities: [
      { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: names },
      { id: 'coffee', name: 'Coffee', kind: 'headcount', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: names },
    ],
    eventSeries: [{ id: 'sundays', name: 'Sundays', responsibilityIds: ['sound', 'coffee'] }],
    events: Array.from({ length: 3 }, (_, i) => ({ id: `w${i + 1}`, seriesId: 'sundays', startsAt: week(i + 1) })),
  });
}

async function persist(groupId: string, version: number | null, result: Ok, rows = rowsFromState(result.state)) {
  const next = await t.store.persist({
    groupId,
    expectedVersion: version,
    rows,
    newGroup: version === null ? { name: 'Crew', time_zone: 'UTC', created_by: ANA } : undefined,
    history: result.history,
  });
  expect(next).not.toBeNull();
  return next as number;
}

async function reload(groupId: string) {
  return stateFromRows((await t.store.load(groupId))!.rows);
}

const answer = (memberId: string, reply: 'yes' | 'no', eventId = 'w1'): Command => ({
  type: 'answerHeadcount',
  eventId,
  responsibilityId: 'coffee',
  memberId,
  answer: reply,
});

describe('headcount Jobs in the database', () => {
  it('round-trips the Job kind and the answers', async () => {
    const groupId = uuid(300);
    let result = run(headcountGroup(groupId), { type: 'fillSchedule' }, 'ana');
    let version = await persist(groupId, null, result);
    result = run(result.state, answer('ana', 'yes'), 'ana');
    version = await persist(groupId, version, result);
    result = run(result.state, answer('ben', 'no'), 'ana');
    version = await persist(groupId, version, result);
    expect(await reload(groupId)).toEqual(result.state);
    expect(result.state.responsibilities.map((r) => r.kind)).toEqual(['turns', 'headcount']);

    // Removing a date drops its answers (they reference the Event).
    result = run(result.state, { type: 'editEventSeries', seriesId: 'sundays', changes: {}, replaceFutureEvents: [
      { id: 'w2', seriesId: 'sundays', startsAt: week(2) },
      { id: 'w3', seriesId: 'sundays', startsAt: week(3) },
    ] }, 'ana');
    expect(result.state.headcountAnswers).toEqual([]);
    await persist(groupId, version, result);
    expect(await reload(groupId)).toEqual(result.state);
  });

  it('keeps the answers when a group-command from before the migration writes (no kind, no answers)', async () => {
    const groupId = uuid(301);
    let result = run(headcountGroup(groupId), { type: 'fillSchedule' }, 'ana');
    let version = await persist(groupId, null, result);
    result = run(result.state, answer('ana', 'yes'), 'ana');
    version = await persist(groupId, version, result);

    // The old function: rows without `kind` and without `headcount_answers`.
    result = run(result.state, { type: 'renameMember', memberId: 'ben', name: 'Benny' }, 'ana');
    const { headcount_answers: _, ...old } = rowsFromState(result.state);
    const oldRows = { ...old, responsibilities: old.responsibilities.map(({ kind: _k, ...r }) => r) };
    await persist(groupId, version, result, oldRows);
    const after = await reload(groupId);
    expect(after.headcountAnswers).toEqual(result.state.headcountAnswers);
    expect(after.responsibilities.map((r) => r.kind)).toEqual(['turns', 'headcount']);
  });

  it('lets Members read the answers, and no one else', async () => {
    const groupId = uuid(302);
    let result = run(headcountGroup(groupId), { type: 'fillSchedule' }, 'ana');
    const version = await persist(groupId, null, result);
    result = run(result.state, answer('ana', 'yes'), 'ana');
    await persist(groupId, version, result);
    const count = 'select count(*)::int as n from public.headcount_answers where group_id = $1';
    const member = await t.asUser(ANA, () => t.db.query<{ n: number }>(count, [groupId]));
    expect(member.rows[0].n).toBe(1);
    const outsider = await t.asUser(OUT, () => t.db.query<{ n: number }>(count, [groupId]));
    expect(outsider.rows[0].n).toBe(0);
    await expect(
      t.asUser(ANA, () =>
        t.db.query(
          `insert into public.headcount_answers (group_id, event_id, responsibility_id, member_id, position, answer, answered_at)
           values ($1, 'w2', 'coffee', 'ana', 9, 'yes', now())`,
          [groupId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('parsing headcount requests', () => {
  it('parses answerHeadcount and the Job kind', () => {
    expect(parseClientCommand({ ...answer('ben', 'yes'), sneaky: 1 })).toEqual(answer('ben', 'yes'));
    expect(() => parseClientCommand({ ...answer('ben', 'yes'), answer: 'maybe' })).toThrow();
    expect(() => parseClientCommand({ type: 'answerHeadcount', eventId: 'w1', responsibilityId: 'coffee', answer: 'yes' })).toThrow();
    expect(
      parseClientCommand({ type: 'editResponsibility', responsibilityId: 'r', changes: { kind: 'headcount' } }),
    ).toEqual({ type: 'editResponsibility', responsibilityId: 'r', changes: { kind: 'headcount' } });
    expect(() => parseClientCommand({ type: 'editResponsibility', responsibilityId: 'r', changes: { kind: 'rota' } })).toThrow();
    const request = parseRequest({
      action: 'createGroup',
      name: 'Crew',
      memberName: 'Ana',
      responsibilities: [
        { id: 'a', name: 'Greeter', headcount: 1, requiresConfirmation: false },
        { id: 'b', name: 'Coffee', kind: 'headcount', headcount: 1, requiresConfirmation: false },
      ],
    });
    expect(request.action === 'createGroup' && request.responsibilities?.map((r) => r.kind)).toEqual([undefined, 'headcount']);
  });
});
