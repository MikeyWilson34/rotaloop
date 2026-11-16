import { router } from 'expo-router';
import { Check, Globe, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  FormScreen,
  Notice,
  SettingsList,
  Sheet,
  Text,
  TextField,
  ValueRow,
} from '@/components/ui';
import { createGroup } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import {
  availableTimeZones,
  deviceTimeZone,
  searchTimeZones,
  timeZoneLabel,
} from '@/lib/groupViews';
import { useProfile } from '@/lib/session';
import { useTheme } from '@/theme';

const NAME_MAX = 80;
const SHOWN = 80;

/**
 * Create a group: its name and time zone. The creator becomes its first Admin and lands on
 * the new Group, where adding Responsibilities comes next (ticket 07).
 */
export default function CreateGroupScreen() {
  const profile = useProfile();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(deviceTimeZone);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give your group a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createGroup({
      name: trimmed,
      memberName: profile.display_name?.trim() || 'Admin',
      timeZone,
    });
    setBusy(false);
    if (!result.ok) {
      setError(groupCommandMessage(result.reason, 'createGroup'));
      return;
    }
    router.replace({ pathname: '/group/[groupId]', params: { groupId: result.groupId } });
  }

  return (
    <FormScreen
      onBack={back}
      title="Create a group"
      lead="Name it and pick its time zone. You'll be its first Admin, and you can invite people next."
      footer={<Button label="Create group" size="lg" loading={busy} onPress={create} />}>
      <TextField
        label="Group name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          if (nameError) setNameError(null);
        }}
        error={nameError}
        placeholder="e.g. Saturday Soccer, Book Club, Front Desk"
        maxLength={NAME_MAX}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={create}
      />
      <SettingsList>
        <ValueRow
          icon={Globe}
          label="Time zone"
          description="Event times and reminders use this."
          value={timeZoneLabel(timeZone).split(' · ')[0]}
          onPress={() => setPicking(true)}
        />
      </SettingsList>
      {error ? <Notice>{error}</Notice> : null}
      <TimeZoneSheet
        visible={picking}
        value={timeZone}
        onClose={() => setPicking(false)}
        onPick={(tz) => {
          setTimeZone(tz);
          setPicking(false);
        }}
      />
    </FormScreen>
  );
}

function TimeZoneSheet({
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
