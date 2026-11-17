import { View } from 'react-native';

import { Button, Text } from '@/components/ui';
import type { AttentionAction, AttentionItem } from '@/home/home';
import { useTheme } from '@/theme';

import { ICONS, TONES, ToneIcon } from './parts';

/** One "Needs your attention" card (prototype `.att`): tone bar, icon, title, line and actions. */
export function AttentionCard({
  item,
  busy,
  onAction,
}: {
  item: AttentionItem;
  /** An action on this card is being sent. */
  busy: boolean;
  onAction: (action: AttentionAction) => void;
}) {
  const { colors, fonts, radii, shadows } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 14,
        paddingRight: 14,
        paddingLeft: 16,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        overflow: 'hidden',
      }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors[TONES[item.tone].bar] }} />
      <ToneIcon icon={ICONS[item.icon]} tone={item.tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 21 }}>{item.title}</Text>
        <Text variant="subhead" color="textSecondary" style={{ marginTop: 2 }}>
          {item.sub}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {item.actions.map((a) => (
            <Button
              key={a.kind}
              label={a.label}
              variant={a.variant}
              loading={busy && (a.kind === 'confirm' || a.kind === 'withdraw')}
              disabled={busy}
              onPress={() => onAction(a)}
              style={{ paddingHorizontal: 14, height: 48 }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
