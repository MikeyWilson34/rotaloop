/** Invite links. Pure: unit-tested under Node. */

/** Invite tokens are 64 lowercase hex characters (`new_token()` in the schema). */
const TOKEN = /[0-9a-f]{64}/i;

/**
 * Pulls the invite token out of whatever was pasted: a full link (any host or path, with the
 * token in the path or the query) or the bare token. Returns null if there's no token in it.
 */
export function parseInviteToken(input: string): string | null {
  const match = input.trim().match(TOKEN);
  return match ? match[0].toLowerCase() : null;
}
