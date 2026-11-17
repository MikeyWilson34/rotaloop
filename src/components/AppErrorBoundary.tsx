import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { hardReload, isChunkLoadError, recoverFromChunkError } from '@/lib/chunkRecovery';
import { useTheme } from '@/theme';

type RecoverFn = () => boolean;

/** Reloads once for a failed code load (web); false when it already tried. */
function recover(): boolean {
  const global = globalThis as { __appChunkRecover?: RecoverFn };
  // Prefer the index.html script: it shares the loop guard and owns the plain fallback.
  if (typeof global.__appChunkRecover === 'function') return global.__appChunkRecover();
  return recoverFromChunkError();
}

/**
 * The screen shown instead of a blank page when rendering throws (expo-router renders it in
 * place of the route that failed; the root layout exports it for the whole app). A failed
 * code load reloads the page once by itself, then offers "Reload"; anything else offers
 * "Try again" (re-renders the route) and "Reload".
 *
 * Deliberately plain (no session, toasts or safe-area context) so it works even when the
 * layout around it is what failed.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, fonts, space, radii } = useTheme();
  const loadFailure = isChunkLoadError(error);
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    console.error('Unhandled error, showing the error screen', error);
    if (loadFailure && isWeb) recover();
  }, [error, loadFailure, isWeb]);

  const button = (label: string, onPress: () => void, primary: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: space.xl,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.primary : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: colors.borderStrong,
        opacity: pressed ? 0.85 : 1,
      })}>
      <RNText style={{ fontFamily: fonts.bold, fontSize: 16, color: primary ? colors.onPrimary : colors.text }}>
        {label}
      </RNText>
    </Pressable>
  );

  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        minHeight: isWeb ? ('100vh' as unknown as number) : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.lg,
        padding: space.lg,
        backgroundColor: colors.bg,
      }}>
      <RNText
        accessibilityRole="header"
        style={{ fontFamily: fonts.extrabold, fontSize: 22, color: colors.text, textAlign: 'center' }}>
        {loadFailure ? "Couldn't load" : 'Something went wrong'}
      </RNText>
      <RNText style={{ fontFamily: fonts.regular, fontSize: 16, color: colors.textSecondary, textAlign: 'center', maxWidth: 360 }}>
        {loadFailure
          ? 'Part of the app didn’t download. Check your connection and reload.'
          : 'Sorry, this screen hit a problem. Try again, or reload the app.'}
      </RNText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' }}>
        {(!loadFailure || !isWeb) && button('Try again', () => void retry(), true)}
        {isWeb && button('Reload', hardReload, loadFailure)}
      </View>
    </View>
  );
}
