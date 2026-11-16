import { ChevronLeft } from 'lucide-react-native';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type FormScreenProps = {
  /** Shows a back chevron in the top bar. */
  onBack?: () => void;
  /** Centred in the top bar (e.g. onboarding step dots). */
  topCenter?: React.ReactNode;
  /** Large title (title1, prototype `.onb-body h1`). */
  title?: string;
  /** Lead paragraph under the title. */
  lead?: string;
  children?: React.ReactNode;
  /** Pinned under the scrolling content, above the keyboard (primary actions). */
  footer?: React.ReactNode;
};

/**
 * The full-screen layout for sign-in and onboarding (prototype `.onb-*`): a top bar,
 * scrolling content with 24px gutters, and a footer that stays above the keyboard.
 */
export function FormScreen({ onBack, topCenter, title, lead, children, footer }: FormScreenProps) {
  const { colors, space, minTapTarget } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 64,
            paddingHorizontal: space.sm,
          }}>
          <View style={{ width: minTapTarget }}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={onBack}
                style={{
                  width: minTapTarget,
                  height: minTapTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
              </Pressable>
            ) : null}
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>{topCenter}</View>
          <View style={{ width: minTapTarget }} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: space.xxl,
            paddingTop: space.md,
            paddingBottom: space.lg,
            gap: space.lg,
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
          }}>
          {title ? (
            <View style={{ gap: space.sm }}>
              <Text variant="title1" accessibilityRole="header">
                {title}
              </Text>
              {lead ? <Text color="textSecondary">{lead}</Text> : null}
            </View>
          ) : null}
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: space.xxl,
              paddingTop: space.md,
              paddingBottom: space.xxl,
              gap: space.sm,
              width: '100%',
              maxWidth: 560,
              alignSelf: 'center',
            }}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Onboarding progress dots (prototype `.onb-dots`): the current step is a wide pill. */
export function StepDots({ count, current }: { count: number; current: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Step ${current + 1} of ${count}`}
      style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 24 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === current ? colors.primary : colors.borderStrong,
          }}
        />
      ))}
    </View>
  );
}
