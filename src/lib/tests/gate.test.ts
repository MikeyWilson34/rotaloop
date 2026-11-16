import { describe, expect, it } from 'vitest';

import { gateFor, redirectFor, type GateInput } from '../gate';

const signedOut: GateInput = {
  sessionLoading: false,
  userId: null,
  profile: null,
  profileError: false,
};

const user = 'user-1';

describe('gateFor', () => {
  it('waits while the stored session is being read', () => {
    expect(gateFor({ ...signedOut, sessionLoading: true })).toBe('loading');
  });

  it('sends signed-out people to sign-in', () => {
    expect(gateFor(signedOut)).toBe('auth');
  });

  it('ignores a stale profile once signed out', () => {
    expect(
      gateFor({ ...signedOut, profile: { id: user, onboarding_completed_at: '2026-11-15T00:00:00Z' } }),
    ).toBe('auth');
  });

  it('waits for the profile after signing in', () => {
    expect(gateFor({ ...signedOut, userId: user })).toBe('loading');
  });

  it('reports a failed profile fetch instead of waiting forever', () => {
    expect(gateFor({ ...signedOut, userId: user, profileError: true })).toBe('profileError');
  });

  it('sends people who have not finished onboarding to onboarding', () => {
    expect(
      gateFor({ ...signedOut, userId: user, profile: { id: user, onboarding_completed_at: null } }),
    ).toBe('onboarding');
  });

  it('lets onboarded people into the app', () => {
    expect(
      gateFor({
        ...signedOut,
        userId: user,
        profile: { id: user, onboarding_completed_at: '2026-11-15T00:00:00Z' },
      }),
    ).toBe('app');
  });

  it("doesn't use another account's profile after switching accounts", () => {
    expect(
      gateFor({
        ...signedOut,
        userId: 'user-2',
        profile: { id: user, onboarding_completed_at: '2026-11-15T00:00:00Z' },
      }),
    ).toBe('loading');
  });
});

describe('redirectFor', () => {
  it('stays put while loading or showing the profile error', () => {
    expect(redirectFor('loading', undefined)).toBeNull();
    expect(redirectFor('profileError', '(tabs)')).toBeNull();
  });

  it('sends signed-out people to the welcome screen from anywhere else', () => {
    expect(redirectFor('auth', undefined)).toBe('/welcome');
    expect(redirectFor('auth', '(tabs)')).toBe('/welcome');
    expect(redirectFor('auth', '+not-found')).toBe('/welcome');
    expect(redirectFor('auth', 'create-group')).toBe('/welcome');
    expect(redirectFor('auth', '(auth)')).toBeNull();
  });

  it('keeps onboarding people in onboarding, except the create-group placeholder', () => {
    expect(redirectFor('onboarding', '(auth)')).toBe('/onboarding');
    expect(redirectFor('onboarding', '(tabs)')).toBe('/onboarding');
    expect(redirectFor('onboarding', '(onboarding)')).toBeNull();
    expect(redirectFor('onboarding', 'create-group')).toBeNull();
  });

  it('keeps join and Group screens for the app (a join link waits until onboarding is done)', () => {
    expect(redirectFor('onboarding', 'join')).toBe('/onboarding');
    expect(redirectFor('onboarding', 'group')).toBe('/onboarding');
    expect(redirectFor('auth', 'join')).toBe('/welcome');
    expect(redirectFor('onboarding', 'join', '[token]')).toBe('/onboarding');
    expect(redirectFor('app', 'join')).toBeNull();
    expect(redirectFor('app', 'group')).toBeNull();
    expect(redirectFor('app', 'assignment')).toBeNull();
    expect(redirectFor('onboarding', 'assignment')).toBe('/onboarding');
    expect(redirectFor('auth', 'assignment')).toBe('/welcome');
    expect(redirectFor('app', 'time-off')).toBeNull();
    expect(redirectFor('onboarding', 'time-off')).toBe('/onboarding');
    expect(redirectFor('auth', 'time-off')).toBe('/welcome');
  });

  it('lets signed-out visitors open an invite link preview, but not the paste screen', () => {
    expect(redirectFor('auth', 'join', '[token]')).toBeNull();
    expect(redirectFor('auth', 'join', 'index')).toBe('/welcome');
    expect(redirectFor('auth', 'join', undefined)).toBe('/welcome');
    expect(redirectFor('auth', 'group', '[groupId]')).toBe('/welcome');
  });

  it('moves onboarded people out of sign-in and onboarding into the app', () => {
    expect(redirectFor('app', '(auth)')).toBe('/');
    expect(redirectFor('app', '(onboarding)')).toBe('/');
    expect(redirectFor('app', '(tabs)')).toBeNull();
    expect(redirectFor('app', 'create-group')).toBeNull();
  });
});
