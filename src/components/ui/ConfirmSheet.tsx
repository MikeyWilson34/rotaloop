import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` paints the confirm button red (for things that can't be undone). */
  tone?: 'default' | 'destructive';
  /** Shows a spinner on the confirm button and blocks closing while the action runs. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A bottom sheet that asks before doing something (design system "Bottom sheet": xl top
 * corners, grab handle, dim scrim, safe-area padding). Works the same on iOS, Android and web,
 * so web never falls back to `window.confirm`.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  loading,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const { colors, radii, space, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const cancel = () => {
    if (!loading) onCancel();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={cancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.scrim,
          }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            boxShadow: shadows.shadow3,
            paddingHorizontal: space.xxl,
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.xxl),
            gap: space.md,
          }}>
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.borderStrong,
              marginBottom: space.sm,
            }}
          />
          <Text variant="title2" accessibilityRole="header">
            {title}
          </Text>
          <Text color="textSecondary">{message}</Text>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Button
              label={confirmLabel}
              size="lg"
              variant={tone === 'destructive' ? 'destructive' : 'primary'}
              loading={loading}
              onPress={onConfirm}
            />
            <Button label={cancelLabel} variant="quiet" disabled={loading} onPress={cancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
