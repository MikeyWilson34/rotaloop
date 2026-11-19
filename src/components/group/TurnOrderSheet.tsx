import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Notice, SettingsList, Sheet, showToast, Text } from '@/components/ui';
import { firstName, moveInOrder, turnOrderCommand, type TurnOrderJob } from '@/lib/groupPage';
import { formatDayShort } from '@/schedule/format';
import { useTheme } from '@/theme';

import { PersonAvatar } from './PersonAvatar';
import type { RunCommand } from './runCommand';

/**
 * "Turn order" (feedback-2 ticket 02, prototype `SHEETS.turns`): one row per person in the
 * job's order with the date they'd get, moved with up/down arrows. Nothing changes until Save;
 * the saved order starts at the job's next date.
 */
export function TurnOrderSheet({ job, run, onClose }: { job: TurnOrderJob; run: RunCommand; onClose: () => void }) {
  const { colors, fonts, minTapTarget } = useTheme();
  const [order, setOrder] = useState(job.order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = order.length - 1;

  async function save() {
    setBusy(true);
    setError(null);
    const failed = await run(turnOrderCommand(job, order), 'reorder');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    showToast('Turn order saved');
  }

  function arrow(index: number, by: -1 | 1, name: string) {
    const disabled = busy || (by === -1 ? index === 0 : index === last);
    const Icon = by === -1 ? ChevronUp : ChevronDown;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Move ${name} ${by === -1 ? 'earlier' : 'later'}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOrder((o) => moveInOrder(o, index, by))}
        style={({ pressed }) => ({
          width: minTapTarget,
          height: minTapTarget,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.3 : pressed ? 0.6 : 1,
        })}>
        <Icon size={22} color={colors.text} strokeWidth={1.75} />
      </Pressable>
    );
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      title="Turn order"
      footer={<Button label="Save" size="lg" loading={busy} onPress={save} />}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 15 }}>{job.name}</Text>
        <Text variant="subhead" color="textSecondary" style={{ marginBottom: 12 }}>
          Use the arrows to move people up or down. After the last person it starts again from the top.
        </Text>
      </View>
      <SettingsList>
        {order.map((p, i) => {
          const name = firstName(p.name);
          const date = job.dates[i];
          return (
            <View
              key={p.memberId}
              testID={`turn-order-row-${i}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 4, minHeight: 52 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, minWidth: 92 }}>{date ? formatDayShort(date) : ''}</Text>
              <PersonAvatar name={p.name} size={32} />
              <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.bold, fontSize: 15 }}>
                {name}
              </Text>
              {arrow(i, -1, name)}
              {arrow(i, 1, name)}
            </View>
          );
        })}
      </SettingsList>
      {error ? (
        <View style={{ marginTop: 12 }}>
          <Notice>{error}</Notice>
        </View>
      ) : null}
    </Sheet>
  );
}
