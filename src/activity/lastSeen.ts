/**
 * When the person last looked at the Activity tab, per account, kept on this device
 * (AsyncStorage, which is localStorage on the web). Unread dots and the tab's count compare
 * history against it. Follow-up: a server column would sync it across devices.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import type { Instant } from '../engine/types';
import { createLastSeenStore } from './lastSeenStore';

export const lastSeenStore = createLastSeenStore(AsyncStorage);

/** The person's "last seen" (`undefined` while it loads from storage). */
export function useLastSeen(userId: string | null): Instant | null | undefined {
  useEffect(() => {
    if (userId) void lastSeenStore.load(userId);
  }, [userId]);
  const get = () => (userId ? lastSeenStore.get(userId) : null);
  return useSyncExternalStore(lastSeenStore.subscribe, get, get);
}
