import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Tables, TablesUpdate } from './database.types';
import { gateFor, type Gate } from './gate';
import { runGroupCommand } from './groupCommand';
import { supabase } from './supabase';

export type Profile = Tables<'profiles'>;
/** The profile columns a person can change about themselves. */
export type ProfilePatch = Omit<TablesUpdate<'profiles'>, 'id' | 'created_at' | 'updated_at'>;

type SessionContextValue = {
  session: Session | null;
  profile: Profile | null;
  /** Where the person belongs: sign-in, onboarding or the app (see gate.ts). */
  gate: Gate;
  /** Re-fetches the profile (after an error, or to pick up server-side changes). */
  reloadProfile: () => Promise<void>;
  /**
   * Saves profile changes under RLS. The change shows immediately; if saving fails, the
   * profile is re-fetched and a plain-language error is returned.
   */
  updateProfile: (patch: ProfilePatch) => Promise<{ error: string | null }>;
  /**
   * Renames the person: saves the profile, then renames their Member in every Group they
   * belong to (`renameMember` through the group-command function).
   */
  setDisplayName: (name: string) => Promise<{ error: string | null }>;
  /** A guest account (anonymous sign-in): no email, and it lives only on this device. */
  isGuest: boolean;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const SAVE_FAILED = "Couldn't save your changes. Check your connection and try again.";
export const RENAME_IN_GROUPS_FAILED =
  "Your name is saved, but some of your groups still show the old one. Try saving it again.";

async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  // The sign-up trigger creates the profile; this only covers accounts made before it existed.
  const inserted = await supabase.from('profiles').insert({ id: userId }).select('*').single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

/** Tracks the Supabase session (via onAuthStateChange) and the signed-in account's profile. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // Both are tagged with the account they belong to, so nothing leaks across a sign-out or
  // an account switch (see gate.ts) and nothing needs clearing when the session changes.
  const [loadedProfile, setProfile] = useState<Profile | null>(null);
  const [profileErrorFor, setProfileErrorFor] = useState<string | null>(null);

  const userId = session?.user.id ?? null;
  const profile = loadedProfile && loadedProfile.id === userId ? loadedProfile : null;

  useEffect(() => {
    // INITIAL_SESSION fires first with the stored session (or null), then every sign-in,
    // sign-out and token refresh. Only set state here: calling Supabase inside this
    // callback can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async (id: string, isCurrent: () => boolean = () => true) => {
    try {
      const next = await fetchProfile(id);
      if (isCurrent()) {
        setProfile(next);
        setProfileErrorFor(null);
      }
    } catch (error) {
      console.warn('Loading the profile failed', error);
      if (isCurrent()) setProfileErrorFor(id);
    }
  }, []);

  // Fetch the profile whenever a different account signs in.
  useEffect(() => {
    if (!userId) return;
    let current = true;
    const isCurrent = () => current;
    // Deferred so no state is set synchronously inside the effect.
    Promise.resolve().then(() => loadProfile(userId, isCurrent));
    return () => {
      current = false;
    };
  }, [userId, loadProfile]);

  const reloadProfile = useCallback(async () => {
    if (!userId) return;
    setProfileErrorFor(null);
    await loadProfile(userId);
  }, [userId, loadProfile]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      if (!userId) return { error: SAVE_FAILED };
      setProfile((prev) => (prev && prev.id === userId ? { ...prev, ...patch } : prev));
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select('*')
        .single();
      if (error) {
        console.warn('Saving the profile failed', error);
        await loadProfile(userId);
        return { error: SAVE_FAILED };
      }
      setProfile(data);
      return { error: null };
    },
    [userId, loadProfile],
  );

  const setDisplayName = useCallback(
    async (name: string) => {
      if (!userId) return { error: SAVE_FAILED };
      const saved = await updateProfile({ display_name: name });
      if (saved.error) return saved;
      const { data: memberships, error } = await supabase
        .from('members')
        .select('id, group_id, display_name')
        .eq('account_id', userId)
        .is('left_at', null);
      if (error) {
        console.warn('Loading memberships for a rename failed', error);
        return { error: RENAME_IN_GROUPS_FAILED };
      }
      const results = await Promise.all(
        (memberships ?? [])
          .filter((m) => m.display_name !== name)
          .map((m) =>
            runGroupCommand(m.group_id, { type: 'renameMember', memberId: m.id, name }),
          ),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        console.warn('Renaming in some Groups failed', failed);
        return { error: RENAME_IN_GROUPS_FAILED };
      }
      return { error: null };
    },
    [userId, updateProfile],
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    // If the server can't be reached, still forget the session on this device.
    if (error) await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const gate = gateFor({
    sessionLoading,
    userId,
    profile,
    profileError: profileErrorFor !== null && profileErrorFor === userId,
  });

  const isGuest = session?.user.is_anonymous ?? false;

  const value = useMemo(
    () => ({
      session,
      profile,
      gate,
      reloadProfile,
      updateProfile,
      setDisplayName,
      isGuest,
      signOut,
    }),
    [session, profile, gate, reloadProfile, updateProfile, setDisplayName, isGuest, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/** The signed-in profile, for screens that only render once there is one. */
export function useProfile(): Profile {
  const { profile } = useSession();
  if (!profile) throw new Error('useProfile needs a loaded profile (the auth gate ensures one).');
  return profile;
}
