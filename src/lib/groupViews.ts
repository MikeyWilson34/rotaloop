/**
 * What the Groups tab and the Group screen show, derived from rows and engine state.
 * Pure: unit-tested under Node.
 */
import type { GroupState, Member } from '../engine';

// ---------------------------------------------------------------------------
// Members tab

export type MemberRowView = {
  id: string;
  name: string;
  isAdmin: boolean;
  /** Added by an Admin by name; nobody has joined as them yet. */
  isPlaceholder: boolean;
  isMe: boolean;
  /** Names of the Responsibilities they're a Qualified Member of, in the Group's order. */
  qualifiedFor: string[];
};

/** The caller's active Member in the Group, if any. */
export function myMember(state: GroupState, accountId: string | null): Member | undefined {
  if (!accountId) return undefined;
  return state.members.find((m) => m.accountId === accountId && m.leftAt === null);
}

/**
 * Active Members for the Members tab: Admins first, then by name. Former Members are left out
 * (their history stays in the schedule).
 */
export function memberRows(state: GroupState, accountId: string | null): MemberRowView[] {
  const responsibilities = state.responsibilities.filter((r) => r.removedAt === null);
  const queues = new Map(state.rotations.map((r) => [r.responsibilityId, new Set(r.queue)]));
  return state.members
    .filter((m) => m.leftAt === null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      isAdmin: m.isAdmin,
      isPlaceholder: m.accountId === null,
      isMe: accountId !== null && m.accountId === accountId,
      qualifiedFor: responsibilities.filter((r) => queues.get(r.id)?.has(m.id)).map((r) => r.name),
    }))
    .sort(compareMembers);
}

function compareMembers(a: MemberRowView, b: MemberRowView): number {
  if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

/** The Admins' names, for "Ask Sam or Lee" notes. */
export function adminNames(state: GroupState): string[] {
  return state.members.filter((m) => m.leftAt === null && m.isAdmin).map((m) => m.name);
}

/** "Sam", "Sam or Lee", "Sam, Lee or Kim". */
export function orList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export function activeMemberCount(state: GroupState): number {
  return state.members.filter((m) => m.leftAt === null).length;
}

/** "1 Member", "4 Members". */
export function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Member' : 'Members'}`;
}

/** The next Event that isn't a Skip Date, from now on. */
export function nextEventAt(state: GroupState, now: Date): string | null {
  const t = now.getTime();
  let best: string | null = null;
  for (const e of state.events) {
    if (e.skipDate || Date.parse(e.startsAt) < t) continue;
    if (best === null || Date.parse(e.startsAt) < Date.parse(best)) best = e.startsAt;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Groups tab

export type MembershipRow = { groupId: string; name: string; timeZone: string; isAdmin: boolean };
export type UpcomingEventRow = { groupId: string; startsAt: string; skipped: boolean };

export type GroupCardView = MembershipRow & {
  /** The Group's next Event (not a Skip Date), or null when it has none yet. */
  nextEventAt: string | null;
};

/**
 * One card per Group: groups with an upcoming Event first (soonest first), then the rest,
 * each by name.
 */
export function groupCards(
  memberships: MembershipRow[],
  events: UpcomingEventRow[],
  now: Date,
): GroupCardView[] {
  const t = now.getTime();
  const next = new Map<string, string>();
  for (const e of events) {
    if (e.skipped || Date.parse(e.startsAt) < t) continue;
    const current = next.get(e.groupId);
    if (current === undefined || Date.parse(e.startsAt) < Date.parse(current)) next.set(e.groupId, e.startsAt);
  }
  return memberships
    .map((m) => ({ ...m, nextEventAt: next.get(m.groupId) ?? null }))
    .sort((a, b) => {
      if (a.nextEventAt && b.nextEventAt && a.nextEventAt !== b.nextEventAt) {
        return Date.parse(a.nextEventAt) - Date.parse(b.nextEventAt);
      }
      if (!!a.nextEventAt !== !!b.nextEventAt) return a.nextEventAt ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.groupId.localeCompare(b.groupId);
    });
}

/** "Sun, Nov 22 · 9:00 AM", in the Group's time zone. */
export function formatEventTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  const opts = { timeZone: safeTimeZone(timeZone) };
  const day = new Intl.DateTimeFormat('en-US', { ...opts, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} · ${time}`;
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

// ---------------------------------------------------------------------------
// Group identity

export const GROUP_ACCENTS = ['blue', 'plum', 'clay', 'teal'] as const;
export type GroupAccentName = (typeof GROUP_ACCENTS)[number];

/** A stable accent per Group (identity only, never status). */
export function accentFor(groupId: string): GroupAccentName {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) hash = (hash * 31 + groupId.charCodeAt(i)) | 0;
  return GROUP_ACCENTS[Math.abs(hash) % GROUP_ACCENTS.length];
}

// ---------------------------------------------------------------------------
// Time zones (create a group)

/** Used where the JS engine can't list time zones (`Intl.supportedValuesOf`). */
export const COMMON_TIME_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/St_Johns',
  'America/Mexico_City',
  'America/Bogota',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export function availableTimeZones(
  supportedValuesOf: ((key: 'timeZone') => string[]) | undefined = (
    Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] }
  ).supportedValuesOf,
): string[] {
  try {
    const all = supportedValuesOf?.('timeZone');
    if (all && all.length > 0) return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch {
    // fall through
  }
  return COMMON_TIME_ZONES;
}

/** "America/New_York" → "New York · America". */
export function timeZoneLabel(timeZone: string): string {
  const parts = timeZone.split('/');
  if (parts.length === 1) return timeZone.replace(/_/g, ' ');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  const region = parts.slice(0, -1).join(' / ').replace(/_/g, ' ');
  return `${city} · ${region}`;
}

/** Time zones whose name matches every word of the query (spaces and underscores alike). */
export function searchTimeZones(zones: string[], query: string): string[] {
  const words = query.toLowerCase().replace(/[_/]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return zones;
  return zones.filter((z) => {
    const hay = z.toLowerCase().replace(/[_/]/g, ' ');
    return words.every((w) => hay.includes(w));
  });
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
