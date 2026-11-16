import { router } from 'expo-router';
import { useState } from 'react';

import { Button, FormScreen, Notice, StepDots, TextField } from '@/components/ui';
import { signInAsGuest } from '@/lib/auth';
import { ONBOARDING_STEPS } from '@/lib/gate';
import { joinName } from '@/lib/validation';

/**
 * "What's your name?" makes the guest account (step 1 of sign-up and onboarding). The name
 * becomes the profile's display name through the sign-up trigger.
 */
export default function NameScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy || !firstName.trim()) return;
    setError(null);
    setBusy(true);
    const result = await signInAsGuest(joinName(firstName, lastName));
    // On success, stay busy: the auth gate moves on to onboarding once the profile loads.
    if (result.error) {
      setBusy(false);
      setError(result.error);
    }
  }

  return (
    <FormScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      topCenter={<StepDots count={ONBOARDING_STEPS} current={0} />}
      title="What's your name?"
      lead="So your groups know who's who."
      footer={
        <Button
          label="Continue"
          size="lg"
          loading={busy}
          disabled={!firstName.trim()}
          onPress={start}
        />
      }>
      <TextField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="First name"
        autoComplete="given-name"
        textContentType="givenName"
        autoCapitalize="words"
        returnKeyType="next"
        autoFocus
        maxLength={60}
      />
      <TextField
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Last name"
        autoComplete="family-name"
        textContentType="familyName"
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={start}
        maxLength={60}
      />
      {error ? <Notice>{error}</Notice> : null}
    </FormScreen>
  );
}
