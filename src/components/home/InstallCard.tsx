import { Share, Smartphone, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Sheet, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { installSteps, installSubtitle } from '@/lib/installCard';
import { useInstallCard } from '@/lib/useInstallCard';
import { useTheme } from '@/theme';

/**
 * "Get Rotaloop on your phone" (feedback-2 ticket 06), website only: a tinted card like the
 * invite card, so Home keeps its one main button. Tapping it installs (Android with the
 * browser's prompt) or opens a sheet with the steps (iPhone, or a phone browser without the
 * prompt). "Not now" hides it on this device for 30 days. Nothing shows on the native apps,
 * on a desktop, or once the app is on the Home Screen (see src/lib/installCard.ts).
 */
export function InstallCard() {
  const { colors, radii, fonts } = useTheme();
  const { variant, install, dismiss } = useInstallCard();
  const [open, setOpen] = useState(false);
  if (!variant) return null;
  const title = `Get ${APP_NAME} on your phone`;
  return (
    <>
      <View style={{ borderRadius: radii.md, backgroundColor: colors.primaryTint }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={() => (variant === 'prompt' ? void install() : setOpen(true))}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingVertical: 16,
            paddingLeft: 16,
            // Room for the close control in the corner.
            paddingRight: 52,
            minHeight: 72,
            opacity: pressed ? 0.85 : 1,
          })}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Smartphone size={22} color={colors.onPrimary} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.extrabold, color: colors.primary, fontSize: 17 }}>{title}</Text>
            <Text variant="subhead" style={{ color: colors.text }}>
              {installSubtitle(variant)}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Not now"
          hitSlop={4}
          onPress={dismiss}
          style={{ position: 'absolute', top: 0, right: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <X size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>
      {variant !== 'prompt' ? <StepsSheet variant={variant} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function StepsSheet({ variant, visible, onClose }: { variant: 'ios' | 'menu'; visible: boolean; onClose: () => void }) {
  const { colors, fonts } = useTheme();
  const steps = installSteps(variant, APP_NAME);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Get ${APP_NAME} on your phone`}
      message={variant === 'ios' ? 'On iPhone, reminders only work from your Home Screen.' : undefined}
      footer={<Button label="Got it" size="lg" onPress={onClose} />}>
      <View style={{ gap: 14, paddingVertical: 4 }}>
        {steps.map((step, i) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 14, color: colors.primary }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1 }}>{step}</Text>
            {variant === 'ios' && i === 0 ? <Share size={22} color={colors.primary} strokeWidth={1.75} accessibilityLabel="the Share icon" /> : null}
          </View>
        ))}
      </View>
    </Sheet>
  );
}
