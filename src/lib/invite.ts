/** Invite links. Pure: unit-tested under Node. */
import { APP_SCHEME, WEB_URL } from '../config/app';

/** Invite tokens are 64 lowercase hex characters (`new_token()` in the schema). */
const TOKEN = /[0-9a-f]{64}/i;
const BARE_TOKEN = /^[0-9a-f]{64}$/i;
/** `/join/<token>` at the end of a path (an optional trailing slash, query or hash is fine). */
const JOIN_PATH = /\/join\/([0-9a-f]{64})\/?(?:[?#].*)?$/i;

/**
 * The link people share and the QR code encodes: an https URL, so it works for anyone who
 * just taps it in a browser. The app opens it too (and `<scheme>://join/<token>`).
 */
export function inviteUrl(token: string, baseUrl: string = WEB_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}/join/${token}`;
}

/** The app-scheme form of an invite link (`rotaloop://join/<token>`). */
export function inviteAppUrl(token: string, scheme: string = APP_SCHEME): string {
  return `${scheme}://join/${token}`;
}

/**
 * Pulls the invite token out of whatever was pasted or scanned: a bare token, any URL ending
 * in `/join/<token>` (https or the app scheme), or failing that any link with the token
 * somewhere in it (e.g. a query string). Returns null if there's no token in it.
 */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  if (BARE_TOKEN.test(text)) return text.toLowerCase();
  const path = text.match(JOIN_PATH);
  if (path) return path[1].toLowerCase();
  const match = text.match(TOKEN);
  return match ? match[0].toLowerCase() : null;
}

/**
 * The token of a URL the app was opened with, only when it is an invite link
 * (`…/join/<token>`). Other URLs (e.g. `/welcome`) return null.
 */
export function inviteTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(JOIN_PATH);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Where the app should go to resume a pending invite (one opened while signed out or
 * mid-onboarding), or null to stay. Only in the app itself: during sign-in and onboarding
 * the token waits (onboarding prefills its join step with it). Once on the join screen the
 * invite is being handled, so nothing more happens.
 */
export function resumeInviteRoute(
  gate: string,
  pendingToken: string | null,
  firstSegment: string | undefined,
): string | null {
  if (gate !== 'app' || !pendingToken) return null;
  if (firstSegment === 'join') return null;
  return `/join/${pendingToken}`;
}

export const NOT_AN_INVITE = "That doesn't look like an invite link. Paste the whole link you were sent.";
