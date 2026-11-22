import { Download, Share, Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Sheet, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { installSteps } from '@/lib/installCard';
import { useInstallCard } from '@/lib/useInstallCard';
import { useTheme } from '@/theme';

/**
 * "Get Rotaloop on your phone" (feedback-2 tickets 06 and 07), website only: a small phone-with-
 * download-arrow icon in the Home header, left of the bell, same size and hit area. A dot shows
 * until it is tapped once on this device. Tapping installs (Android with the browser's prompt) or
 * opens a sheet with the steps (iPhone, or a phone browser without the prompt). Nothing shows on
 * the native apps, on a desktop, or once the app is on the Home Screen (src/lib/installCard.ts).
 */
export function InstallIcon() {
  const { colors } = useTheme();
  const { variant, fresh, install, markSeen } = useInstallCard();
  const [open, setOpen] = useState(false);
  if (!variant) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Get ${APP_NAME} on your phone`}
        onPress={() => {
          markSeen();
          if (variant === 'prompt') void install();
          else setOpen(true);
        }}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Smartphone size={24} color={colors.text} strokeWidth={1.75} />
          <View style={{ position: 'absolute' }}>
            <Download size={10} color={colors.text} strokeWidth={2.5} />
          </View>
        </View>
        {fresh ? (
          <View
            testID="install-dot"
            style={{ position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bg }}
          />
        ) : null}
      </Pressable>
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
