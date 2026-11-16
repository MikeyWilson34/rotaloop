import { useState } from 'react';

import { Button, ConfirmSheet, type ButtonVariant } from '@/components/ui';
import { useSession } from '@/lib/session';

export const GUEST_SIGN_OUT_TITLE = 'Sign out of this guest account?';
export const GUEST_SIGN_OUT_WARNING =
  "Signing out of a guest account can't be undone. You'll lose access to your groups on this device.";

/**
 * "Sign out", which always asks first in an in-app sheet. A guest account has no email or
 * password, so signing out loses it for good.
 */
export function SignOutButton({ variant = 'secondary' }: { variant?: ButtonVariant }) {
  const { isGuest, signOut } = useSession();
  const [asking, setAsking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirm() {
    setSigningOut(true);
    await signOut();
    // The auth gate moves to the welcome screen; this unmounts with the signed-in screens.
  }

  return (
    <>
      <Button label="Sign out" variant={variant} onPress={() => setAsking(true)} />
      <ConfirmSheet
        visible={asking}
        title={isGuest ? GUEST_SIGN_OUT_TITLE : 'Sign out?'}
        message={isGuest ? GUEST_SIGN_OUT_WARNING : 'You can sign back in any time.'}
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone={isGuest ? 'destructive' : 'default'}
        loading={signingOut}
        onConfirm={confirm}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
