/**
 * Home's "Needs your attention" collapse state, kept on this device (AsyncStorage, which is
 * localStorage on the web). Starts expanded and stays expanded if storage can't be read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { loadAttentionCollapsed, saveAttentionCollapsed } from './attentionCollapse';

export function useAttentionCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(false);
  // Once the person taps, a slow read must not undo their choice.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void loadAttentionCollapsed(AsyncStorage).then((stored) => {
      if (live && !touched.current) setCollapsed(stored);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback(() => {
    touched.current = true;
    const next = !collapsed;
    setCollapsed(next);
    void saveAttentionCollapsed(AsyncStorage, next);
  }, [collapsed]);

  return [collapsed, toggle];
}
