import { CalendarX, Undo2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ConfirmSheet, showToast, Text } from '@/components/ui';
import type { GroupDetails } from '@/lib/groups';
import { formatDayShort } from '@/schedule/format';
import type { EventView } from '@/schedule/views';
import { useTheme } from '@/theme';

import type { RunCommand } from '../group/MemberActionsSheet';
import { SkipDateSheet } from './SkipDateSheet';

/** "Add a Skip Date" (prototype `skip-open`): a full-width secondary button opening the 3-step sheet. */
export function AddSkipDateButton({
  group,
  accountId,
  isAdmin,
  run,
}: {
  group: GroupDetails;
  accountId: string | null;
  isAdmin: boolean;
  run: RunCommand;
}) {
  const { colors, fonts, radii } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a Skip Date"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 16,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: colors.surface,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}>
        <CalendarX size={20} color={colors.text} strokeWidth={1.75} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 }}>Add a Skip Date</Text>
      </Pressable>
      <SkipDateSheet
        visible={open}
        onClose={() => setOpen(false)}
        group={group}
        accountId={accountId}
        isAdmin={isAdmin}
        run={run}
      />
    </>
  );
}

/** "Remove Skip Date" under a Skip Date card (any Member), with an in-app confirm. */
export function RemoveSkipDateButton({ event, run }: { event: EventView; run: RunCommand }) {
  const { colors, fonts, minTapTarget } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = formatDayShort(event.date);

  async function remove() {
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'removeSkipDate', eventId: event.eventId }, 'removeSkipDate');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setConfirming(false);
    showToast('Skip Date removed. Rotation restored.', Undo2);
  }

  return (
    <View style={{ alignSelf: 'flex-start', marginTop: -6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove Skip Date, ${day}`}
        onPress={() => {
          setError(null);
          setConfirming(true);
        }}
        style={({ pressed }) => ({
          minHeight: minTapTarget,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 8,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Undo2 size={16} color={colors.primary} strokeWidth={2} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.primary }}>Remove Skip Date</Text>
      </Pressable>
      <ConfirmSheet
        visible={confirming}
        title="Remove this Skip Date?"
        message={`${day} needs people again, and the Rotation is restored: everyone moves back to where they were. Anyone whose date changes is asked to confirm again.`}
        confirmLabel="Remove Skip Date"
        loading={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
