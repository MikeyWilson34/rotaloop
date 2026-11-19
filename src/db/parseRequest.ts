/**
 * Validates an untrusted `group-command` request body and rebuilds it from known fields
 * only, so nothing unexpected reaches the engine or the database. Instants are
 * normalized to `Date#toISOString()` form.
 */
import type {
  CoverTarget,
  EventSeriesChanges,
  GroupSettings,
  NewEvent,
  NewEventSeries,
  NewResponsibility,
  NewTimeOff,
  RepeatPattern,
  ResponsibilityChanges,
} from '../engine';
import type { ClientCommand, GroupCommandRequest } from './protocol';

export class InvalidRequest extends Error {}

const MAX_ID = 64;
const MAX_NAME = 80;
const MAX_LIST = 500;
/** Skip Date and Decline reasons, and Time Off notes (the engine accepts reasons up to 300). */
const MAX_REASON = 300;
const MAX_NOTE = 200;

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new InvalidRequest(message);
}

function obj(value: unknown, field: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Obj;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) fail(`${field} must be 1-${max} characters`);
  return trimmed;
}

/** Free text that may be blank (stored as null). */
function optionalText(value: unknown, field: string, max: number): string | null {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`);
  return trimmed.length === 0 ? null : trimmed;
}

const id = (value: unknown, field: string) => text(value, field, MAX_ID);
const name = (value: unknown, field: string) => text(value, field, MAX_NAME);

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${field} must be an ISO 8601 timestamp`);
  return new Date(Date.parse(value)).toISOString();
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`${field} must be true or false`);
  return value;
}

function oneOf<const T extends string>(value: unknown, field: string, options: readonly T[]): T {
  if (!options.includes(value as T)) fail(`${field} must be one of ${options.join(', ')}`);
  return value as T;
}

function list<T>(value: unknown, field: string, item: (v: unknown, f: string) => T, max = MAX_LIST): T[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (value.length > max) fail(`${field} has more than ${max} items`);
  return value.map((v, i) => item(v, `${field}[${i}]`));
}

function uniqueIds<T extends { id: string }>(items: T[], field: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} has a duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return items;
}

const ids = (value: unknown, field: string) => list(value, field, id);

/** `undefined` stays absent; `null` is kept when allowed. */
function optional<T>(value: unknown, parse: (v: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

// ---------------------------------------------------------------------------

function newEvent(value: unknown, field: string): NewEvent {
  const o = obj(value, field);
  const event: NewEvent = {
    id: id(o.id, `${field}.id`),
    seriesId: nullable(o.seriesId, (v) => id(v, `${field}.seriesId`)),
    startsAt: instant(o.startsAt, `${field}.startsAt`),
  };
  const responsibilityIds = optional(o.responsibilityIds, (v) => nullable(v, (x) => ids(x, `${field}.responsibilityIds`)));
  if (responsibilityIds !== undefined) event.responsibilityIds = responsibilityIds;
  if (event.seriesId === null && !event.responsibilityIds) fail(`${field}: a one-off Event must list its Responsibilities`);
  return event;
}

function newTimeOff(value: unknown, field: string): NewTimeOff {
  const o = obj(value, field);
  const timeOff: NewTimeOff = {
    id: id(o.id, `${field}.id`),
    memberId: id(o.memberId, `${field}.memberId`),
    startsAt: instant(o.startsAt, `${field}.startsAt`),
    endsAt: instant(o.endsAt, `${field}.endsAt`),
  };
  if (Date.parse(timeOff.endsAt) < Date.parse(timeOff.startsAt)) fail(`${field} ends before it starts`);
  const repeatEveryWeeks = optional(o.repeatEveryWeeks, (v) => nullable(v, (x) => int(x, `${field}.repeatEveryWeeks`, 1, 52)));
  const repeatUntil = optional(o.repeatUntil, (v) => nullable(v, (x) => instant(x, `${field}.repeatUntil`)));
  const responsibilityIds = optional(o.responsibilityIds, (v) => nullable(v, (x) => ids(x, `${field}.responsibilityIds`)));
  const zone = optional(o.timeZone, (v) => nullable(v, (x) => timeZone(x, `${field}.timeZone`)));
  const note = optional(o.note, (v) => nullable(v, (x) => optionalText(x, `${field}.note`, MAX_NOTE)));
  if (repeatEveryWeeks !== undefined) timeOff.repeatEveryWeeks = repeatEveryWeeks;
  if (repeatUntil !== undefined) timeOff.repeatUntil = repeatUntil;
  if (responsibilityIds !== undefined) timeOff.responsibilityIds = responsibilityIds;
  if (zone !== undefined) timeOff.timeZone = zone;
  if (note !== undefined) timeOff.note = note;
  return timeOff;
}

function settings(value: unknown, field: string): Partial<GroupSettings> {
  const o = obj(value, field);
  const result: Partial<GroupSettings> = {};
  if (o.coveragePolicy !== undefined) {
    result.coveragePolicy = oneOf(o.coveragePolicy, `${field}.coveragePolicy`, ['payItBack', 'countRealWork']);
  }
  if (o.timeOffHandling !== undefined) {
    result.timeOffHandling = oneOf(o.timeOffHandling, `${field}.timeOffHandling`, ['routeAround', 'askVolunteer']);
  }
  if (o.allowDoubling !== undefined) result.allowDoubling = bool(o.allowDoubling, `${field}.allowDoubling`);
  if (o.replacementDuty !== undefined) {
    result.replacementDuty = oneOf(o.replacementDuty, `${field}.replacementDuty`, ['assignedMember', 'admins']);
  }
  if (o.replacementDeadlineMs !== undefined) {
    // Up to 60 days before the Event.
    result.replacementDeadlineMs = int(o.replacementDeadlineMs, `${field}.replacementDeadlineMs`, 0, 60 * 86_400_000);
  }
  return result;
}

function coverTarget(value: unknown, field: string): CoverTarget {
  const o = obj(value, field);
  if (o.guestName !== undefined) return { guestName: name(o.guestName, `${field}.guestName`) };
  return { memberId: id(o.memberId, `${field}.memberId`) };
}

const MAX_HEADCOUNT = 50;

function responsibility(value: unknown, field: string): NewResponsibility {
  const o = obj(value, field);
  return {
    id: id(o.id, `${field}.id`),
    name: name(o.name, `${field}.name`),
    headcount: int(o.headcount, `${field}.headcount`, 1, MAX_HEADCOUNT),
    requiresConfirmation: bool(o.requiresConfirmation, `${field}.requiresConfirmation`),
  };
}

function responsibilityChanges(value: unknown, field: string): ResponsibilityChanges {
  const o = obj(value, field);
  const changes: ResponsibilityChanges = {};
  if (o.name !== undefined) changes.name = name(o.name, `${field}.name`);
  if (o.headcount !== undefined) changes.headcount = int(o.headcount, `${field}.headcount`, 1, MAX_HEADCOUNT);
  if (o.requiresConfirmation !== undefined) {
    changes.requiresConfirmation = bool(o.requiresConfirmation, `${field}.requiresConfirmation`);
  }
  return changes;
}

function timeZone(value: unknown, field: string): string {
  const zone = text(value, field, MAX_ID);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    fail(`${field} must be an IANA time zone`);
  }
  return zone;
}

function weekOfMonth(value: unknown, field: string): number {
  if (![1, 2, 3, 4, -1].includes(value as number)) fail(`${field} must be 1-4, or -1 for the last`);
  return value as number;
}

function repeatPattern(value: unknown, field: string): RepeatPattern {
  const o = obj(value, field);
  const frequency = oneOf(o.frequency, `${field}.frequency`, ['weekly', 'biweekly', 'monthly', 'custom']);
  const daysOfWeek = list(o.daysOfWeek, `${field}.daysOfWeek`, (v, f) => int(v, f, 0, 6), 7);
  if (daysOfWeek.length === 0 || new Set(daysOfWeek).size !== daysOfWeek.length) {
    fail(`${field}.daysOfWeek must list distinct days`);
  }
  const startTime = text(o.startTime, `${field}.startTime`, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) fail(`${field}.startTime must be HH:MM`);
  const startsOn = text(o.startsOn, `${field}.startsOn`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || Number.isNaN(Date.parse(`${startsOn}T00:00:00Z`))) {
    fail(`${field}.startsOn must be YYYY-MM-DD`);
  }
  return {
    frequency,
    intervalWeeks: frequency === 'custom' ? int(o.intervalWeeks, `${field}.intervalWeeks`, 1, 52) : null,
    daysOfWeek: [...daysOfWeek].sort((a, b) => a - b),
    weekOfMonth: frequency === 'monthly' ? weekOfMonth(o.weekOfMonth, `${field}.weekOfMonth`) : null,
    startTime,
    timeZone: timeZone(o.timeZone, `${field}.timeZone`),
    startsOn,
  };
}

function eventSeries(value: unknown, field: string): NewEventSeries {
  const o = obj(value, field);
  const series: NewEventSeries = {
    id: id(o.id, `${field}.id`),
    name: name(o.name, `${field}.name`),
    responsibilityIds: ids(o.responsibilityIds, `${field}.responsibilityIds`),
  };
  const repeat = optional(o.repeat, (v) => nullable(v, (x) => repeatPattern(x, `${field}.repeat`)));
  if (repeat !== undefined) series.repeat = repeat;
  return series;
}

function eventSeriesChanges(value: unknown, field: string): EventSeriesChanges {
  const o = obj(value, field);
  const changes: EventSeriesChanges = {};
  if (o.name !== undefined) changes.name = name(o.name, `${field}.name`);
  if (o.responsibilityIds !== undefined) changes.responsibilityIds = ids(o.responsibilityIds, `${field}.responsibilityIds`);
  if (o.repeat !== undefined) changes.repeat = nullable(o.repeat, (x) => repeatPattern(x, `${field}.repeat`));
  return changes;
}

const events = (value: unknown, field: string) => uniqueIds(list(value, field, newEvent), field);

export function parseClientCommand(value: unknown): ClientCommand {
  const o = obj(value, 'command');
  const f = (key: string) => `command.${key}`;
  switch (o.type) {
    case 'fillSchedule':
      return { type: 'fillSchedule' };
    case 'addEvents':
      return { type: 'addEvents', events: events(o.events, f('events')) };
    case 'addSkipDate': {
      const reason = optional(o.reason, (v) => nullable(v, (x) => optionalText(x, f('reason'), MAX_REASON)));
      const command: Extract<ClientCommand, { type: 'addSkipDate' }> = { type: 'addSkipDate', eventId: id(o.eventId, f('eventId')) };
      if (reason) command.reason = reason;
      return command;
    }
    case 'removeSkipDate':
      return { type: o.type, eventId: id(o.eventId, f('eventId')) };
    case 'addTimeOff':
      return { type: 'addTimeOff', timeOff: newTimeOff(o.timeOff, f('timeOff')) };
    case 'removeTimeOff':
      return { type: 'removeTimeOff', timeOffId: id(o.timeOffId, f('timeOffId')) };
    case 'requestConfirmation':
      return { type: 'requestConfirmation', assignmentIds: ids(o.assignmentIds, f('assignmentIds')) };
    case 'decline': {
      const reason = optional(o.reason, (v) => nullable(v, (x) => optionalText(x, f('reason'), MAX_REASON)));
      const command: Extract<ClientCommand, { type: 'decline' }> = { type: 'decline', assignmentId: id(o.assignmentId, f('assignmentId')) };
      if (reason) command.reason = reason;
      if (o.coveredBy !== undefined) command.coveredBy = coverTarget(o.coveredBy, f('coveredBy'));
      return command;
    }
    case 'confirm':
    case 'withdrawDecline':
    case 'cover':
      return { type: o.type, assignmentId: id(o.assignmentId, f('assignmentId')) };
    case 'markCovered':
      return {
        type: 'markCovered',
        assignmentId: id(o.assignmentId, f('assignmentId')),
        by: coverTarget(o.by, f('by')),
      };
    case 'changeSettings':
      return { type: 'changeSettings', settings: settings(o.settings, f('settings')) };
    case 'rebalance':
      return { type: 'rebalance', responsibilityId: id(o.responsibilityId, f('responsibilityId')) };
    case 'addMember': {
      const member = obj(o.member, f('member'));
      const command: ClientCommand = { type: 'addMember', member: { name: name(member.name, f('member.name')) } };
      const qualifiedFor = optional(o.qualifiedFor, (v) => ids(v, f('qualifiedFor')));
      if (qualifiedFor) command.qualifiedFor = qualifiedFor;
      return command;
    }
    case 'qualifyMember':
    case 'unqualifyMember':
      return {
        type: o.type,
        memberId: id(o.memberId, f('memberId')),
        responsibilityId: id(o.responsibilityId, f('responsibilityId')),
      };
    case 'removeMember':
      return { type: 'removeMember', memberId: id(o.memberId, f('memberId')) };
    case 'renameMember':
      return { type: 'renameMember', memberId: id(o.memberId, f('memberId')), name: name(o.name, f('name')) };
    case 'setAdmin':
      return { type: 'setAdmin', memberId: id(o.memberId, f('memberId')), isAdmin: bool(o.isAdmin, f('isAdmin')) };
    case 'addResponsibility': {
      const command: ClientCommand = {
        type: 'addResponsibility',
        responsibility: responsibility(o.responsibility, f('responsibility')),
      };
      const qualified = optional(o.qualifiedMemberIds, (v) => ids(v, f('qualifiedMemberIds')));
      if (qualified) command.qualifiedMemberIds = qualified;
      return command;
    }
    case 'editResponsibility':
      return {
        type: 'editResponsibility',
        responsibilityId: id(o.responsibilityId, f('responsibilityId')),
        changes: responsibilityChanges(o.changes, f('changes')),
      };
    case 'removeResponsibility':
      return { type: 'removeResponsibility', responsibilityId: id(o.responsibilityId, f('responsibilityId')) };
    case 'reorderResponsibilities':
      return { type: 'reorderResponsibilities', responsibilityIds: ids(o.responsibilityIds, f('responsibilityIds')) };
    case 'setPrimaryResponsibility':
      return {
        type: 'setPrimaryResponsibility',
        responsibilityId: nullable(o.responsibilityId, (v) => id(v, f('responsibilityId'))),
      };
    case 'reorderQueue':
      return {
        type: 'reorderQueue',
        responsibilityId: id(o.responsibilityId, f('responsibilityId')),
        queue: ids(o.queue, f('queue')),
      };
    case 'addEventSeries': {
      const command: ClientCommand = { type: 'addEventSeries', series: eventSeries(o.series, f('series')) };
      const seriesEvents = optional(o.events, (v) => events(v, f('events')));
      if (seriesEvents) command.events = seriesEvents;
      return command;
    }
    case 'editEventSeries': {
      const command: ClientCommand = {
        type: 'editEventSeries',
        seriesId: id(o.seriesId, f('seriesId')),
        changes: eventSeriesChanges(o.changes, f('changes')),
      };
      const replacement = optional(o.replaceFutureEvents, (v) => events(v, f('replaceFutureEvents')));
      if (replacement) command.replaceFutureEvents = replacement;
      return command;
    }
    case 'removeEventSeries':
      return { type: 'removeEventSeries', seriesId: id(o.seriesId, f('seriesId')) };
    case 'removeEvent':
      return { type: 'removeEvent', eventId: id(o.eventId, f('eventId')) };
    default:
      return fail(`Unknown command type ${String(o.type)}`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequest(value: unknown): GroupCommandRequest {
  const o = obj(value, 'request');
  switch (o.action) {
    case 'command': {
      if (typeof o.groupId !== 'string' || !UUID.test(o.groupId)) fail('groupId must be a UUID');
      return { action: 'command', groupId: o.groupId.toLowerCase(), command: parseClientCommand(o.command) };
    }
    case 'createGroup': {
      const responsibilities = uniqueIds(
        optional(o.responsibilities, (v) => list(v, 'responsibilities', responsibility, 50)) ?? [],
        'responsibilities',
      );
      const request: GroupCommandRequest = {
        action: 'createGroup',
        name: name(o.name, 'name'),
        memberName: name(o.memberName, 'memberName'),
        responsibilities,
        eventSeries: uniqueIds(
          optional(o.eventSeries, (v) => list(v, 'eventSeries', eventSeries, 50)) ?? [],
          'eventSeries',
        ),
        events: uniqueIds(optional(o.events, (v) => list(v, 'events', newEvent)) ?? [], 'events'),
        creatorQualifiedFor: optional(o.creatorQualifiedFor, (v) => ids(v, 'creatorQualifiedFor')) ?? [],
      };
      const timeZone = optional(o.timeZone, (v) => text(v, 'timeZone', MAX_ID));
      if (timeZone !== undefined) request.timeZone = timeZone;
      const groupSettings = optional(o.settings, (v) => settings(v, 'settings'));
      if (groupSettings !== undefined) request.settings = groupSettings;
      const primary = optional(o.primaryResponsibilityId, (v) => nullable(v, (x) => id(x, 'primaryResponsibilityId')));
      if (primary !== undefined) request.primaryResponsibilityId = primary;
      const known = new Set(responsibilities.map((r) => r.id));
      for (const r of [...(primary ? [primary] : []), ...(request.creatorQualifiedFor ?? [])]) {
        if (!known.has(r)) fail(`Unknown Responsibility ${r}`);
      }
      return request;
    }
    case 'join':
      return { action: 'join', token: text(o.token, 'token', 200), memberName: name(o.memberName, 'memberName') };
    default:
      return fail(`Unknown action ${String(o.action)}`);
  }
}
