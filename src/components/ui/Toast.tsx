import { CircleCheck, type LucideIcon } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
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

// ---------------------------------------------------------------------------
// Open bottom sheets: a confirmation goes inside the top one instead of a toast over its buttons.

type SheetNote = ToastState & { at: number };
const openSheets: number[] = [];
const sheetNotes = new Map<number, SheetNote>();
const sheetListeners = new Set<() => void>();
let nextSheetId = 1;
/** A note that lands in a sheet which then closes this soon is shown as a toast instead. */
const CLOSING_MS = 1500;

function emitSheets() {
  for (const l of sheetListeners) l();
}

function route(message: string, icon?: LucideIcon) {
  const top = openSheets[openSheets.length - 1];
  if (top === undefined) return emit({ id: nextId++, message, icon });
  sheetNotes.set(top, { id: nextId++, message, icon, at: Date.now() });
  emitSheets();
}

/**
 * Shows a short confirmation at the bottom of the app column (prototype `.toast`), or inside
 * the open bottom sheet when there is one, so it never covers the sheet's buttons. Routing
 * waits a tick, so a sheet closed in the same handler is already gone.
 */
export function showToast(message: string, icon?: LucideIcon) {
  setTimeout(() => route(message, icon), 0);
}

/**
 * For Sheet: registers the sheet while it is visible and returns the confirmation to show
 * inside it, if any.
 */
export function useSheetNote(visible: boolean): ToastState {
  const [id] = useState(() => nextSheetId++);
  useLayoutEffect(() => {
    if (!visible) return;
    openSheets.push(id);
    return () => {
      openSheets.splice(openSheets.indexOf(id), 1);
      const note = sheetNotes.get(id);
      sheetNotes.delete(id);
      emitSheets();
      if (note && Date.now() - note.at < CLOSING_MS) emit({ id: nextId++, message: note.message, icon: note.icon });
    };
  }, [visible, id]);
  return useSyncExternalStore(
    subscribeSheets,
    () => sheetNotes.get(id) ?? null,
    () => null,
  );
}

const subscribeSheets = (listener: () => void) => {
  sheetListeners.add(listener);
  return () => sheetListeners.delete(listener);
};

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
