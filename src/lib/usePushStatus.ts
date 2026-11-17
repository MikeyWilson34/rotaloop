import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getPushStatus } from './push';
import type { PushChannelStatus } from './pushStatus';

/**
 * This device's (or browser's) push status, re-read when the app comes back to the
 * foreground (the person may have changed their settings) and after `refresh()`.
 * `null` while loading.
 */
export function usePushStatus(): { status: PushChannelStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<PushChannelStatus | null>(null);
  const refresh = useCallback(() => {
    getPushStatus().then(setStatus, () => setStatus('unsupported'));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { status, refresh };
}
