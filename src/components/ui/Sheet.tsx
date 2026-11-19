import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleCheck } from 'lucide-react-native';

import { appColumnMaxWidth, useTheme } from '@/theme';

import { Text } from './Text';
import { useSheetNote } from './Toast';

export type SheetProps = {
  visible: boolean;
  /** Called on scrim tap, Android back, or a close button. Ignored while `busy`. */
  onClose: () => void;
  /** Small eyebrow above the title (e.g. the Group's name). */
  overline?: string;
  title?: string;
  /** Short line under the title. */
  message?: string;
  /** Blocks closing while an action runs. */
  busy?: boolean;
  children?: React.ReactNode;
  /** Pinned under the scrolling content (actions). */
  footer?: React.ReactNode;
  /** Label for the scrim's close action (screen readers). */
  closeLabel?: string;
};

/**
 * A bottom sheet (design system "Bottom sheet": xl top corners, grab handle, dim scrim,
 * safe-area padding). It scrolls when tall and stays above the keyboard.
 */
export function Sheet({
  visible,
  onClose,
  overline,
  title,
  message,
  busy,
  children,
  footer,
  closeLabel = 'Close',
}: SheetProps) {
  const { colors, fonts, radii, space, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  // A confirmation shown while this sheet is open (showToast) appears inside it, not over it.
  const note = useSheetNote(visible);
  const NoteIcon = note?.icon ?? CircleCheck;
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={close}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            // As wide as the app column, so on a desktop the sheet stays in the column.
            maxWidth: appColumnMaxWidth,
            maxHeight: '92%',
            alignSelf: 'center',
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            boxShadow: shadows.shadow3,
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.xxl),
          }}>
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.borderStrong,
              marginBottom: space.md,
            }}
          />
          <ScrollView
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: space.xxl, gap: space.md }}>
            {note ? (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: radii.md,
                  backgroundColor: colors.successTint,
                }}>
                <NoteIcon size={20} color={colors.successText} strokeWidth={2} />
                <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.text }}>{note.message}</Text>
              </View>
            ) : null}
            {overline || title || message ? (
              <View style={{ gap: space.xs }}>
                {overline ? (
                  <Text variant="overline" color="textSecondary">
                    {overline}
                  </Text>
                ) : null}
                {title ? (
                  <Text variant="title2" accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
                {message ? <Text color="textSecondary">{message}</Text> : null}
              </View>
            ) : null}
            {children}
          </ScrollView>
          {footer ? (
            <View style={{ paddingHorizontal: space.xxl, paddingTop: space.md, gap: space.sm }}>{footer}</View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
