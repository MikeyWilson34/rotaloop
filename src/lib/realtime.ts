import { useEffect, useRef } from 'react';

import { createRealtimeHub, type PgBinding, type RealtimeClientLike } from './realtimeHub';
import { supabase } from './supabase';

export type { PgBinding } from './realtimeHub';

/**
 * The app's one realtime hub. Every live-update hook goes through it (never call
 * `supabase.channel()` directly): subscribers with the same bindings share a channel.
 */
export const realtime = createRealtimeHub(supabase as unknown as RealtimeClientLike);

/**
 * Calls `onChange` (debounced) while mounted whenever a row matching any of `bindings`
 * changes. Pass null to listen to nothing. One engine write touches several rows, so
 * the debounce turns a burst of changes into one reload.
 */
export function useRealtimeChanges(
  label: string,
  bindings: PgBinding[] | null,
  onChange: () => void,
  debounceMs = 300,
) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  // A string, so a new array with the same bindings doesn't resubscribe.
  const key = bindings && bindings.length > 0 ? JSON.stringify(bindings) : null;

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = realtime.subscribe(label, JSON.parse(key) as PgBinding[], () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChangeRef.current();
      }, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [label, key, debounceMs]);
}
