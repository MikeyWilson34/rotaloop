import { ms } from './time';
import type { Assignment, AssignmentStatus, GroupSettings, Instant, ReplacementDuty } from './types';

/** The default Admin alert lead time: 3 days before the Event. */
export const DEFAULT_ALERT_LEAD_TIME_MS = 3 * 24 * 60 * 60 * 1000;

function needsCoverage(a: Assignment): boolean {
  return a.coverageRequest !== null && a.coverageRequest.cover === null;
}

/**
 * Unconfirmed: confirmation is required but still missing when the Admin's alert
 * lead time before the Event arrives. Each Admin passes their own lead time.
 */
export function isUnconfirmed(
  assignment: Assignment,
  eventStartsAt: Instant,
  now: Instant,
  alertLeadTimeMs: number = DEFAULT_ALERT_LEAD_TIME_MS,
): boolean {
  if (needsCoverage(assignment)) return false;
  const awaiting = assignment.confirmation === 'notYetRequested' || assignment.confirmation === 'requested';
  return awaiting && ms(now) >= ms(eventStartsAt) - alertLeadTimeMs;
}

/**
 * The status shown for an Assignment:
 * Needs coverage > Unconfirmed > Pending (confirmation requested) > Covered >
 * Confirmed > Scheduled (confirmation not required or not requested yet).
 */
export function assignmentStatus(
  assignment: Assignment,
  eventStartsAt: Instant,
  now: Instant,
  alertLeadTimeMs: number = DEFAULT_ALERT_LEAD_TIME_MS,
): AssignmentStatus {
  if (needsCoverage(assignment)) return 'needsCoverage';
  if (isUnconfirmed(assignment, eventStartsAt, now, alertLeadTimeMs)) return 'unconfirmed';
  if (assignment.confirmation === 'requested') return 'pending';
  if (assignment.coverageRequest?.cover) return 'covered';
  if (assignment.confirmation === 'confirmed') return 'confirmed';
  return 'scheduled';
}

/**
 * Who holds Replacement Duty for a Coverage Request right now: `null` until the
 * Group's "find a replacement by" deadline, then the Group's setting.
 */
export function replacementDutyHolder(
  assignment: Assignment,
  eventStartsAt: Instant,
  settings: GroupSettings,
  now: Instant,
): ReplacementDuty | null {
  if (!needsCoverage(assignment)) return null;
  return ms(now) >= ms(eventStartsAt) - settings.replacementDeadlineMs ? settings.replacementDuty : null;
}
