import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  router,
  useSegments,
  type Href,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { SignOutButton } from '@/components/SignOutButton';
import { Button, FormScreen, Notice } from '@/components/ui';
import { redirectFor } from '@/lib/gate';
import { inviteTokenFromUrl, resumeInviteRoute } from '@/lib/invite';
import { loadPendingInvite, setPendingInvite, usePendingInvite } from '@/lib/pendingInvite';
import { SessionProvider, useSession } from '@/lib/session';
import { useTheme } from '@/theme';
import { useAppFonts } from '@/theme/fonts';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.bg,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };

  return (
    <SessionProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <RootNavigator />
      </ThemeProvider>
    </SessionProvider>
  );
}

/**
 * The auth gate. Each route group is only reachable in its gate state (see src/lib/gate.ts);
 * when the state changes, expo-router moves to the first screen that is allowed. `redirectFor`
 * also covers the URL the app opened on (e.g. "/" while signed out, or a stale web link).
 * - signed out → (auth): welcome, name (which makes a guest account)
 * - signed in, onboarding not finished → (onboarding)
 * - otherwise → (tabs)
 */
function RootNavigator() {
  const [fontsLoaded, fontError] = useAppFonts();
  const { gate } = useSession();
  const ready = (fontsLoaded || !!fontError) && gate !== 'loading';
  const segments = useSegments();
  const pendingInvite = usePendingInvite();
  const url = Linking.useLinkingURL();
  const redirect = ready
    ? (resumeInviteRoute(gate, pendingInvite, segments[0]) ?? redirectFor(gate, segments[0]))
    : null;

  useEffect(() => {
    loadPendingInvite();
  }, []);

  // An invite link opened before the app is usable (a web URL load or a deep link while
  // signed out, mid-onboarding or still loading) is remembered, so it survives sign-in and
  // onboarding and then resumes. In the app, expo-router opens the join screen itself.
  useEffect(() => {
    const token = inviteTokenFromUrl(url);
    if (token && gate !== 'app') setPendingInvite(token);
  }, [url, gate]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (redirect) router.replace(redirect as Href);
  }, [redirect]);

  // The splash screen stays up until the session and profile are known.
  if (!ready) return null;
  if (gate === 'profileError') return <ProfileError />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate === 'auth'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'onboarding'}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'app'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'onboarding' || gate === 'app'}>
        <Stack.Screen name="create-group" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'app'}>
        <Stack.Screen name="group/[groupId]/index" />
        <Stack.Screen name="join/index" />
        <Stack.Screen name="join/[token]" />
      </Stack.Protected>
    </Stack>
  );
}

function ProfileError() {
  const { reloadProfile } = useSession();
  return (
    <FormScreen
      title="Something went wrong"
      footer={
        <>
          <Button label="Try again" size="lg" onPress={reloadProfile} />
          <SignOutButton variant="quiet" />
        </>
      }>
      <Notice>{"We couldn't load your profile. Check your connection and try again."}</Notice>
    </FormScreen>
  );
}
