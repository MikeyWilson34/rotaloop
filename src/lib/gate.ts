/**
 * Which part of the app a person may see, from their session and profile.
 * Pure: no React, Supabase or React Native imports, so it is unit-tested under Node.
 */

/** The three route groups under src/app, plus "still working it out". */
export type Gate = 'loading' | 'profileError' | 'auth' | 'onboarding' | 'app';

export type GateInput = {
  /** True until the stored session has been read on launch. */
  sessionLoading: boolean;
  /** The signed-in account's id, or null when signed out. */
  userId: string | null;
  /** The fetched profile, or null if it isn't loaded (or failed to load). */
  profile: { id: string; onboarding_completed_at: string | null } | null;
  /** Set when fetching the profile failed. */
  profileError: boolean;
};

export function gateFor(input: GateInput): Gate {
  if (input.sessionLoading) return 'loading';
  if (!input.userId) return 'auth';
  // A profile left over from a previous account doesn't count.
  const profile = input.profile && input.profile.id === input.userId ? input.profile : null;
  if (!profile) {
    if (input.profileError) return 'profileError';
    return 'loading';
  }
  return profile.onboarding_completed_at ? 'app' : 'onboarding';
}

/**
 * Steps shown in the progress dots from sign-up to the app: name (in `(auth)`, which makes the
 * guest account), then notifications and join-or-create (in `(onboarding)`).
 */
export const ONBOARDING_STEPS = 3;

/** Where each gate lands when the current route isn't one it allows. */
export const GATE_HOME = {
  auth: '/welcome',
  onboarding: '/onboarding',
  app: '/',
} as const;

/** Top-level route segments each gate may show (route groups and stand-alone screens). */
const ALLOWED_SEGMENTS: Record<keyof typeof GATE_HOME, readonly string[]> = {
  auth: ['(auth)'],
  onboarding: ['(onboarding)', 'create-group'],
  // A join link opened mid-onboarding waits (see resumeInviteRoute in invite.ts), so
  // `join` and `group` are app-only (apart from the signed-out invite preview below).
  app: ['(tabs)', 'create-group', 'group', 'assignment', 'join', 'time-off', 'activity'],
};

/**
 * The route to replace the current one with, or null to stay. `firstSegment` and
 * `secondSegment` are the first two of expo-router's `useSegments()` (undefined at the root,
 * or e.g. "+not-found").
 */
export function redirectFor(
  gate: Gate,
  firstSegment: string | undefined,
  secondSegment?: string,
): string | null {
  if (gate === 'loading' || gate === 'profileError') return null;
  // A signed-out visitor may open an invite link (`/join/<token>`): it shows the Group's name
  // and sends them to make a guest account. The invite is kept and resumes after onboarding.
  if (gate === 'auth' && firstSegment === 'join' && secondSegment === '[token]') return null;
  if (firstSegment && ALLOWED_SEGMENTS[gate].includes(firstSegment)) return null;
  return GATE_HOME[gate];
}
