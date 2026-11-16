import { RefreshCw } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme } from '@/theme';

/** The app's mark: a navy rounded tile with the loop icon (prototype `.onb-hero`). */
export function AppMark() {
  const { colors, shadows, space } = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: 88,
        height: 88,
        borderRadius: 26,
        backgroundColor: colors.navy,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: shadows.shadow2,
        marginTop: space.xxl,
        marginBottom: space.xl,
      }}>
      <RefreshCw size={44} color={colors.onNavy} strokeWidth={2} />
    </View>
  );
}
