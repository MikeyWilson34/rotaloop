import { CircleCheck, type LucideIcon } from 'lucide-react-native';
import { useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Text } from './Text';

type ToastState = { id: number; message: string; icon?: LucideIcon } | null;

let current: ToastState = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: ToastState) {
  current = next;
  for (const l of listeners) l();
}

/** Shows a short confirmation at the bottom of the app column (prototype `.toast`). */
export function showToast(message: string, icon?: LucideIcon) {
  emit({ id: nextId++, message, icon });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Mounted once in the root layout. The latest toast shows for a few seconds; it never takes taps. */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, () => current, () => null);
  const { colors, fonts, radii, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = setTimeout(() => {
      if (current?.id === id) emit(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  const Icon = toast.icon ?? CircleCheck;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: insets.bottom + 96,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radii.lg - 2,
        backgroundColor: colors.text,
        boxShadow: shadows.shadow2,
      }}>
      <Icon size={20} color={colors.bg} strokeWidth={2} />
      <Text style={{ flex: 1, color: colors.bg, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 }}>{toast.message}</Text>
    </View>
  );
}
