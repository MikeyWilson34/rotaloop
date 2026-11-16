import { describe, expect, it } from 'vitest';

import {
  OFFLINE,
  SIGN_IN_FAILED,
  SIGN_IN_OFF,
  TOO_MANY_SIGN_INS,
  signInErrorMessage,
} from '../authErrors';

describe('signInErrorMessage', () => {
  it('explains the per-network rate limit on new guest accounts', () => {
    expect(signInErrorMessage({ status: 429, code: 'over_request_rate_limit' })).toBe(
      TOO_MANY_SIGN_INS,
    );
    expect(signInErrorMessage({ status: 429, message: 'Request rate limit reached' })).toBe(
      TOO_MANY_SIGN_INS,
    );
  });

  it('explains network failures', () => {
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(OFFLINE);
    expect(signInErrorMessage({ message: 'Failed to fetch' })).toBe(OFFLINE);
    expect(signInErrorMessage({ message: 'Network request failed' })).toBe(OFFLINE);
  });

  it('explains when guest sign-in is switched off on the server', () => {
    expect(signInErrorMessage({ status: 422, code: 'anonymous_provider_disabled' })).toBe(SIGN_IN_OFF);
    expect(signInErrorMessage({ status: 422, message: 'Anonymous sign-ins are disabled' })).toBe(
      SIGN_IN_OFF,
    );
    expect(signInErrorMessage({ status: 422, code: 'signup_disabled' })).toBe(SIGN_IN_OFF);
  });

  it('falls back to a plain message', () => {
    expect(signInErrorMessage({ status: 500, message: 'Database error saving new user' })).toBe(
      SIGN_IN_FAILED,
    );
  });
});
