import { UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Notice, Sheet, Text, TextField } from '@/components/ui';
import { MAX_COVER_NAME, outsideCoverName, type CantMakeItView, type CoverPickerView } from '@/coverage/sheets';
import { useTheme } from '@/theme';

import { MiniAvatar } from './parts';

type SheetBase = {
  visible: boolean;
  onClose: () => void;
  busy: boolean;
  /** A plain-language error from the last attempt. */
  error: string | null;
};

/**
 * "Can't make it?" (prototype `cant`): the details line and two choices. "Ask the group for
 * cover" sends `decline`; "I'll find someone to cover" opens the "Who is covering?" picker.
 */
export function CantMakeItSheet({
  view,
  onAsk,
  onFind,
  ...base
}: SheetBase & { view: CantMakeItView; onAsk: () => void; onFind: () => void }) {
  const { space } = useTheme();
  return (
    <Sheet
      visible={base.visible}
      onClose={base.onClose}
      busy={base.busy}
      title={view.title}
      footer={
        <>
          <Button label={view.askLabel} size="lg" loading={base.busy} onPress={onAsk} />
          {view.findLabel ? (
            <Button label={view.findLabel} variant="secondary" size="lg" disabled={base.busy} onPress={onFind} />
          ) : (
            <Button label="Never mind" variant="quiet" disabled={base.busy} onPress={base.onClose} />
          )}
        </>
      }>
      <View style={{ gap: space.xs }}>
        <Text variant="bodyStrong">{view.details}</Text>
        <Text color="textSecondary">{view.message}</Text>
      </View>
      {base.error ? <Notice>{base.error}</Notice> : null}
    </Sheet>
  );
}

/**
 * "Who is covering?" (prototype `pick`): the group's Members (Stand-ins included) and "Someone
 * else", which asks for a typed name. Choosing sets the cover straight away.
 */
export function CoverPickerSheet({
  view,
  onPickMember,
  onPickOutside,
  ...base
}: SheetBase & {
  view: CoverPickerView;
  onPickMember: (memberId: string, name: string) => void;
  onPickOutside: (name: string) => void;
}) {
  const { colors, radii, space, fonts } = useTheme();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const name = outsideCoverName(text);

  if (typing) {
    return (
      <Sheet
        visible={base.visible}
        onClose={base.onClose}
        busy={base.busy}
        title="Their name"
        footer={
          <>
            <Button label="Done" size="lg" loading={base.busy} disabled={!name} onPress={() => name && onPickOutside(name)} />
            <Button label="Back" variant="quiet" disabled={base.busy} onPress={() => setTyping(false)} />
          </>
        }>
        <TextField
          label="Name"
          value={text}
          onChangeText={setText}
          maxLength={MAX_COVER_NAME}
          placeholder="e.g. Pat Jones"
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => name && onPickOutside(name)}
        />
        <Text variant="caption" color="textSecondary">
          {"They're not in the group, so this is a one-off: no swap."}
        </Text>
        {base.error ? <Notice>{base.error}</Notice> : null}
      </Sheet>
    );
  }

  const row = (pressed: boolean, disabled: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <Sheet
      visible={base.visible}
      onClose={base.onClose}
      busy={base.busy}
      title={view.title}
      footer={<Button label="Cancel" variant="quiet" disabled={base.busy} onPress={base.onClose} />}>
      <View style={{ gap: space.sm }}>
        {view.options.map((o) => (
          <Pressable
            key={o.memberId}
            accessibilityRole="button"
            accessibilityLabel={o.detail ? `${o.name}. ${o.detail}` : o.name}
            accessibilityState={{ disabled: o.disabled || base.busy }}
            disabled={o.disabled || base.busy}
            onPress={() => onPickMember(o.memberId, o.name)}
            style={({ pressed }) => row(pressed, o.disabled)}>
            <MiniAvatar name={o.name} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subhead" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
                {o.name}
              </Text>
              {o.detail ? (
                <Text variant="caption" color="textSecondary" numberOfLines={1}>
                  {o.detail}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        {view.options.length === 0 ? (
          <Text color="textSecondary" style={{ padding: space.md }}>
            No one else in the group yet.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view.otherLabel}
          disabled={base.busy}
          onPress={() => setTyping(true)}
          style={({ pressed }) => row(pressed, false)}>
          <View style={{ width: 32, alignItems: 'center' }}>
            <UserPlus size={20} color={colors.primary} strokeWidth={1.75} />
          </View>
          <Text variant="subhead" style={{ flex: 1, fontFamily: fonts.bold, color: colors.primary }}>
            {view.otherLabel}
          </Text>
        </Pressable>
      </View>
      {base.error ? <Notice>{base.error}</Notice> : null}
    </Sheet>
  );
}
