import { Stack } from 'expo-router';

/** First-launch onboarding, shown until `profiles.onboarding_completed_at` is set. */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
