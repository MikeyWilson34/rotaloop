import { View } from 'react-native';

import { appColumnMaxWidth, useTheme } from '@/theme';

/**
 * Keeps the whole app in one centred column on wide screens (the website on a desktop), with
 * the page background around it. On a phone the column is simply the full width. Applied once
 * in the root layout, so every screen and the tab bar sit inside it; bottom sheets use the same
 * width (see Sheet).
 */
export function AppColumn({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: appColumnMaxWidth,
          backgroundColor: colors.bg,
          overflow: 'hidden',
          // A hairline edge only shows once the window is wider than the column.
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: colors.border,
          marginHorizontal: -1,
        }}>
        {children}
      </View>
    </View>
  );
}
