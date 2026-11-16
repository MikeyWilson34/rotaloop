import { Stack } from 'expo-router';

// Entering the group (e.g. on sign-out) starts at the welcome screen.
export const unstable_settings = { initialRouteName: 'welcome' };

/** Signed-out screens: welcome → name (which makes the guest account). */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="name" />
    </Stack>
  );
}
