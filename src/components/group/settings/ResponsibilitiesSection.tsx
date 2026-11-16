import { router } from 'expo-router';
import { ArrowUpDown, ListChecks, Plus, Star } from 'lucide-react-native';
import { useState } from 'react';

import {
  ActionRow,
  Button,
  FieldLabel,
  Notice,
  ReorderList,
  SettingsList,
  Sheet,
  Text,
  ValueRow,
} from '@/components/ui';
import type { GroupDetails } from '@/lib/groups';
import { moveItem, responsibilityViews } from '@/lib/groupSetup';

import type { RunCommand } from '../MemberActionsSheet';

export function openResponsibility(groupId: string, responsibilityId: string) {
  router.push({
    pathname: '/group/[groupId]/responsibility/[responsibilityId]',
    params: { groupId, responsibilityId },
  });
}

/** Settings → Responsibilities: the list (fill order), add, and change the fill order. */
export function ResponsibilitiesSection({ group, isAdmin, run }: { group: GroupDetails; isAdmin: boolean; run: RunCommand }) {
  const views = responsibilityViews(group.state);
  const [ordering, setOrdering] = useState(false);

  return (
    <>
      <FieldLabel>Responsibilities</FieldLabel>
      <SettingsList>
        {views.map((r) => (
          <ValueRow
            key={r.id}
            icon={r.isPrimary ? Star : ListChecks}
            label={r.isPrimary ? `${r.name} · Primary` : r.name}
            description={r.summary}
            onPress={() => openResponsibility(group.id, r.id)}
          />
        ))}
        {isAdmin ? (
          <ActionRow icon={Plus} label="Add Responsibility" onPress={() => openResponsibility(group.id, 'new')} />
        ) : null}
        {isAdmin && views.length > 1 ? (
          <ActionRow
            icon={ArrowUpDown}
            label="Change fill order"
            description="Earlier Responsibilities are filled first at each Event."
            onPress={() => setOrdering(true)}
          />
        ) : null}
      </SettingsList>
      {views.length === 0 ? (
        <Text variant="subhead" color="textSecondary">
          {isAdmin
            ? 'No Responsibilities yet. Add the duties your group shares, like Host or Setup.'
            : "Your Admins haven't added Responsibilities yet."}
        </Text>
      ) : null}
      {ordering ? (
        <FillOrderSheet
          groupName={group.name}
          initial={views.map((v) => ({ key: v.id, label: v.name }))}
          run={run}
          onClose={() => setOrdering(false)}
        />
      ) : null}
    </>
  );
}

function FillOrderSheet({
  groupName,
  initial,
  run,
  onClose,
}: {
  groupName: string;
  initial: { key: string; label: string }[];
  run: RunCommand;
  onClose: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = items.some((item, i) => item.key !== initial[i]?.key);

  async function save() {
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'reorderResponsibilities', responsibilityIds: items.map((i) => i.key) }, 'reorder');
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={groupName}
      title="Fill order"
      message="At each Event, Responsibilities are filled in this order. It matters when someone could take more than one."
      footer={
        <>
          <Button label="Save order" size="lg" loading={busy} disabled={!changed} onPress={save} />
          <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
        </>
      }>
      <ReorderList items={items} disabled={busy} onMove={(index, delta) => setItems((list) => moveItem(list, index, delta))} />
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
