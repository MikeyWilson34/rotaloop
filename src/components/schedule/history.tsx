import { View } from 'react-native';

import { Text } from '@/components/ui';
import { formatWhen } from '@/schedule/format';
import type { HistoryTone } from '@/schedule/history';
import { useTheme, type ColorTokens } from '@/theme';

const toneColor: Record<HistoryTone, keyof ColorTokens | null> = {
  ok: 'success',
  bad: 'danger',
  info: 'primary',
  warn: 'warning',
  neutral: null,
};

export type TimelineItem = { key: string; at: string; text: string; detail: string | null; tone: HistoryTone };

/** A vertical timeline (prototype `.timeline`): a dot per entry, coloured by tone. */
export function Timeline({ items, now, timeZone }: { items: TimelineItem[]; now: string; timeZone: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ paddingLeft: 22 }}>
      <View style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 2, backgroundColor: colors.border }} />
      {items.map((item) => {
        const tone = toneColor[item.tone];
        return (
          <View key={item.key} style={{ paddingTop: 6, paddingBottom: 10 }}>
            <View
              style={{
                position: 'absolute',
                left: -21,
                top: 10,
                width: 12,
                height: 12,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: tone ? colors[tone] : colors.borderStrong,
                backgroundColor: tone ? colors[tone] : colors.surface,
              }}
            />
            <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
              {item.text}
            </Text>
            {item.detail ? (
              <Text variant="subhead" color="textSecondary">
                {item.detail}
              </Text>
            ) : null}
            <Text variant="caption" color="textTertiary">
              {formatWhen(item.at, now, timeZone)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** A list of history entries in a surface list (prototype `.act` rows), newest first. */
export function HistoryList({ items, now, timeZone }: { items: TimelineItem[]; now: string; timeZone: string }) {
  const { colors, radii, shadows } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        overflow: 'hidden',
      }}>
      {items.map((item, i) => {
        const tone = toneColor[item.tone];
        return (
          <View
            key={item.key}
            style={{
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}>
            <View
              style={{
                marginTop: 6,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: tone ? colors[tone] : colors.borderStrong,
              }}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
              {item.detail ? (
                <Text variant="subhead" color="textSecondary">
                  {item.detail}
                </Text>
              ) : null}
              <Text variant="caption" color="textTertiary">
                {formatWhen(item.at, now, timeZone)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
