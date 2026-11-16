/**
 * An invite link opened before the person could use it (signed out, or mid-onboarding). It is
 * kept here, also in AsyncStorage so it survives a restart or a web reload, and resumed once
 * they're in the app (see resumeInviteRoute in invite.ts). Onboarding prefills its join step
 * with it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const KEY = 'rotaloop.pendingInviteToken';

let token: string | null = null;
let loaded = false;
// Set or cleared before the stored value arrived: the stored value is stale.
let touched = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Loads the stored token once (call early; harmless to call again). */
export async function loadPendingInvite(): Promise<void> {
  if (loaded) return;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (!touched && stored) token = stored;
  } catch {
    // Storage unavailable (e.g. private browsing): keep it in memory only.
  }
  loaded = true;
  emit();
}

export function setPendingInvite(next: string | null): void {
  touched = true;
  if (token !== next) {
    token = next;
    emit();
  }
  const write = next ? AsyncStorage.setItem(KEY, next) : AsyncStorage.removeItem(KEY);
  write.catch(() => {});
}

export function clearPendingInvite(): void {
  setPendingInvite(null);
}

export function getPendingInvite(): string | null {
  return token;
}

/** The pending invite token, or null. */
export function usePendingInvite(): string | null {
  return useSyncExternalStore(subscribe, getPendingInvite, getPendingInvite);
}
