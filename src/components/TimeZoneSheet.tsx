import { Check, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button, Sheet, Text } from '@/components/ui';
import { availableTimeZones, searchTimeZones, timeZoneLabel } from '@/lib/groupViews';
import { useTheme } from '@/theme';

const SHOWN = 80;

/** A searchable list of IANA time zones in a bottom sheet (create a group, group settings, Event Series). */
export function TimeZoneSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onPick: (timeZone: string) => void;
}) {
  const { colors, radii, space, typography, fonts } = useTheme();
  const [query, setQuery] = useState('');
  const zones = useMemo(() => availableTimeZones(), []);
  const matches = useMemo(() => searchTimeZones(zones, query), [zones, query]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Time zone" footer={<Button label="Cancel" variant="quiet" onPress={onClose} />}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 52,
          paddingHorizontal: 14,
          borderRadius: radii.md,
          borderWidth: 1.5,
          borderColor: colors.borderStrong,
          backgroundColor: colors.surfaceAlt,
        }}>
        <Search size={20} color={colors.textSecondary} strokeWidth={1.75} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a city"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Search time zones"
          autoCorrect={false}
          autoCapitalize="none"
          style={[typography.body, { flex: 1, color: colors.text, minHeight: 48 }]}
        />
      </View>
      <ScrollView style={{ height: 360 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {matches.length === 0 ? (
          <Text color="textSecondary" style={{ padding: space.md }}>
            No matching time zones.
          </Text>
        ) : null}
        {matches.slice(0, SHOWN).map((item) => {
          const selected = item === value;
          return (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLabel={timeZoneLabel(item)}
              onPress={() => onPick(item)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                paddingHorizontal: space.sm,
                borderRadius: radii.sm,
                backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
              })}>
              <Text style={{ flex: 1, fontFamily: selected ? fonts.bold : fonts.regular }}>{timeZoneLabel(item)}</Text>
              {selected ? <Check size={20} color={colors.primary} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
        {matches.length > SHOWN ? (
          <Text variant="subhead" color="textSecondary" style={{ padding: space.md }}>
            Keep typing to see more.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
