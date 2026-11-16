import { Handshake, Scale, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { eventTimeText } from '@/components/schedule/cards';
import { DateBox } from '@/components/schedule/parts';
import { Button, Chip, ChipGroup, FieldLabel, Notice, Sheet, Text, TextField } from '@/components/ui';
import {
  DECLINE_REASON_SAVED,
  DECLINE_REASONS,
  nameList,
  type CoverSheetView,
  type DeclineSheetView,
  type MarkCoveredSheetView,
} from '@/coverage/sheets';
import { groupCommandMessage } from '@/lib/groupErrors';
import { formatDayLong } from '@/schedule/format';
import { useTheme } from '@/theme';

import { MiniAvatar, Note, PeopleRow } from './parts';

type SheetBase = {
  visible: boolean;
  onClose: () => void;
  busy: boolean;
  /** A plain-language error from the last attempt. */
  error: string | null;
};

/** "Can't make Sound?": who we'll ask, the deadline, Pay It Back. Sends `decline`. */
export function DeclineSheet({ view, onSubmit, ...base }: SheetBase & { view: DeclineSheetView; onSubmit: () => void }) {
  const { colors, radii, space } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Sheet
      visible={base.visible}
      onClose={base.onClose}
      busy={base.busy}
      overline={view.overline}
      title={view.title}
      message={view.message}
      footer={
        <>
          <Button label={view.submitLabel} size="lg" loading={base.busy} onPress={onSubmit} />
          <Button label="Never mind" variant="quiet" disabled={base.busy} onPress={base.onClose} />
        </>
      }>
      {DECLINE_REASON_SAVED && !view.withdrawingCover ? (
        <>
          <FieldLabel>Reason</FieldLabel>
          <ChipGroup>
            {DECLINE_REASONS.map((r) => (
              <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(reason === r ? null : r)} />
            ))}
          </ChipGroup>
          <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything the group should know?" />
        </>
      ) : null}
      <FieldLabel>{"Who we'll ask"}</FieldLabel>
      <View style={{ padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceAlt, gap: space.sm }}>
        <PeopleRow
          names={view.ask.names}
          text={view.ask.names.length ? `${nameList(view.ask.names)}, ${view.ask.line}` : view.ask.line}
        />
        <Text variant="caption" color="textSecondary">
          {view.deadlineNote}
        </Text>
      </View>
      {view.payItBack ? (
        <Note icon={Handshake} tone="primary">
          {view.payItBack}
        </Note>
      ) : null}
      {view.makeUpNote ? (
        <Text variant="caption" color="textSecondary">
          {view.makeUpNote}
        </Text>
      ) : null}
      {base.error ? <Notice>{base.error}</Notice> : null}
    </Sheet>
  );
}

/** "Cover Sound for Ben?": the Event, workload, and the Make-up Turn preview. Sends `cover`. */
export function CoverSheet({
  view,
  groupTimeZone,
  viewerTimeZone,
  onSubmit,
  ...base
}: SheetBase & { view: CoverSheetView; groupTimeZone: string; viewerTimeZone: string; onSubmit: () => void }) {
  const { colors, radii, space } = useTheme();
  const problem = view.problem ? groupCommandMessage(view.problem, 'cover') : null;
  const error = base.error ?? problem;
  return (
    <Sheet
      visible={base.visible}
      onClose={base.onClose}
      busy={base.busy}
      overline={view.overline}
      title={view.title}
      footer={
        <>
          <Button
            label="Yes, I'll cover"
            variant="positive"
            size="lg"
            loading={base.busy}
            disabled={!!problem}
            onPress={onSubmit}
          />
          <Button label="Not this time" variant="quiet" disabled={base.busy} onPress={base.onClose} />
        </>
      }>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 14,
          borderRadius: radii.md,
          backgroundColor: colors.surfaceAlt,
        }}>
        <DateBox date={view.date} mine />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{formatDayLong(view.date)}</Text>
          <Text variant="subhead" color="textSecondary">
            {eventTimeText(view.startsAt, groupTimeZone, viewerTimeZone)}
          </Text>
        </View>
      </View>
      <Note icon={Scale} tone="success">
        {view.workloadNote}
      </Note>
      {view.makeUp ? (
        <Note icon={Handshake} tone="primary">
          {view.makeUp}
        </Note>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
      <View style={{ height: space.xs }} />
    </Sheet>
  );
}

/** "Who's covering Sound?": any Group Member, or a Guest Cover by name. Sends `markCovered`. */
export function MarkCoveredSheet({
  view,
  onPickMember,
  onGuest,
  ...base
}: SheetBase & {
  view: MarkCoveredSheetView;
  onPickMember: (memberId: string, name: string) => void;
  onGuest: (name: string) => void;
}) {
  const { colors, radii, space, fonts } = useTheme();
  const [guest, setGuest] = useState('');
  return (
    <Sheet
      visible={base.visible}
      onClose={base.onClose}
      busy={base.busy}
      overline={view.overline}
      title={view.title}
      message={view.message}
      footer={<Button label="Cancel" variant="quiet" disabled={base.busy} onPress={base.onClose} />}>
      <View style={{ gap: space.sm }}>
        {view.options.map((o) => (
          <Pressable
            key={o.memberId}
            accessibilityRole="button"
            accessibilityLabel={`${o.name}. ${o.detail}`}
            accessibilityState={{ disabled: o.disabled || base.busy }}
            disabled={o.disabled || base.busy}
            onPress={() => onPickMember(o.memberId, o.name)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: 56,
              paddingHorizontal: space.md,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
              opacity: o.disabled ? 0.5 : 1,
            })}>
            <MiniAvatar name={o.name} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subhead" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
                {o.name}
              </Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {o.detail}
              </Text>
            </View>
            {o.disabled ? null : <UserRound size={18} color={colors.textTertiary} strokeWidth={1.75} />}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text variant="caption" color="textTertiary" style={{ fontFamily: fonts.bold }}>
          or a Guest Cover
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Guest name"
            value={guest}
            onChangeText={setGuest}
            placeholder="Name, e.g. John Smith"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => guest.trim() && onGuest(guest.trim())}
          />
        </View>
        <Button
          label="Save"
          variant="secondary"
          loading={base.busy}
          disabled={!guest.trim()}
          onPress={() => onGuest(guest.trim())}
          style={{ height: 52 }}
        />
      </View>
      <Text variant="caption" color="textSecondary">
        {view.guestNote}
      </Text>
      {base.error ? <Notice>{base.error}</Notice> : null}
    </Sheet>
  );
}
