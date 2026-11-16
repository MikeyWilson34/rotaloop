import { ScrollView, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type ScreenProps = ScrollViewProps & {
  /** Large screen title (title1). */
  title: string;
};

/** A scrolling screen with the app background, side gutters and a large title. */
export function Screen({ title, children, contentContainerStyle, ...rest }: ScreenProps) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[
          {
            paddingHorizontal: space.lg,
            paddingTop: space.lg,
            paddingBottom: space.xxxl,
            gap: space.md,
          },
          contentContainerStyle,
        ]}
        {...rest}>
        <Text variant="title1" accessibilityRole="header">
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
