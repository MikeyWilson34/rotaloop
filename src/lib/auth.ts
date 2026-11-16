import { signInErrorMessage } from './authErrors';
import { supabase } from './supabase';

/**
 * Creates a guest account on this device (Supabase anonymous sign-in): no email or password.
 * The sign-up trigger names the new profile from `display_name`. On success the session
 * provider sees the sign-in and the gate moves on to onboarding.
 *
 * The account lives only in this device's stored session. Before launch, "Save your account"
 * should link an email or Apple/Google to it (see .scratch/domain-grilling/decisions.md).
 */
export async function signInAsGuest(displayName: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });
    return { error: error ? signInErrorMessage(error) : null };
  } catch (error) {
    return { error: signInErrorMessage(error as Error) };
  }
}
