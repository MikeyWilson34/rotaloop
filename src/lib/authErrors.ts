/** Plain-language messages for sign-in failures. Pure: unit-tested under Node. */

/** The shape of the errors supabase-js returns (AuthError and friends), loosely. */
export type AuthErrorLike = { message?: string; status?: number; code?: string; name?: string } | null;

export const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
export const TOO_MANY_SIGN_INS =
  'Too many new accounts have been made from this network recently. Wait a while, then try again.';
export const SIGN_IN_OFF = 'New accounts are turned off right now.';
export const SIGN_IN_FAILED = "We couldn't set up your account just now. Try again in a moment.";

function isNetworkError(error: NonNullable<AuthErrorLike>): boolean {
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /network|fetch|failed to fetch/i.test(error.message ?? '')
  );
}

function isRateLimited(error: NonNullable<AuthErrorLike>): boolean {
  return (
    error.status === 429 ||
    (error.code ?? '').includes('rate_limit') ||
    /rate limit|security purposes/i.test(error.message ?? '')
  );
}

/** For `signInAnonymously` (making a guest account). */
export function signInErrorMessage(error: NonNullable<AuthErrorLike>): string {
  if (isNetworkError(error)) return OFFLINE;
  if (isRateLimited(error)) return TOO_MANY_SIGN_INS;
  if (
    error.code === 'anonymous_provider_disabled' ||
    error.code === 'signup_disabled' ||
    /anonymous sign-ins are disabled|signups not allowed/i.test(error.message ?? '')
  ) {
    return SIGN_IN_OFF;
  }
  return SIGN_IN_FAILED;
}
