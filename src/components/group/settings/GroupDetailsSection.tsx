import { Globe, Type, Users } from 'lucide-react-native';
import { useState } from 'react';

import { TimeZoneSheet } from '@/components/TimeZoneSheet';
import { Button, FieldLabel, InfoRow, Notice, SettingsList, Sheet, TextField, ValueRow } from '@/components/ui';
import { updateGroupDetails, type GroupDetails } from '@/lib/groups';
import { NAME_MAX, validateGroupName } from '@/lib/groupSetup';
import { activeMemberCount, memberCountLabel, timeZoneLabel } from '@/lib/groupViews';

/** Settings → Group: name and time zone (Admins edit them via `update_group_details`). */
export function GroupDetailsSection({
  group,
  isAdmin,
  reload,
}: {
  group: GroupDetails;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<'name' | 'timeZone' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zone = timeZoneLabel(group.timeZone).split(' · ')[0];

  async function save(name: string, timeZone: string): Promise<string | null> {
    const failed = await updateGroupDetails(group.id, name, timeZone);
    if (!failed) await reload();
    return failed;
  }

  return (
    <>
      <FieldLabel>Group</FieldLabel>
      <SettingsList>
        {isAdmin ? (
          <ValueRow icon={Type} label="Name" value={group.name} onPress={() => setEditing('name')} />
        ) : (
          <InfoRow icon={Type} label="Name" value={group.name} />
        )}
        {isAdmin ? (
          <ValueRow
            icon={Globe}
            label="Time zone"
            description="New Event Series and one-off Events use it."
            value={zone}
            onPress={() => {
              setError(null);
              setEditing('timeZone');
            }}
          />
        ) : (
          <InfoRow icon={Globe} label="Time zone" value={zone} />
        )}
        <InfoRow icon={Users} label="Members" value={memberCountLabel(activeMemberCount(group.state))} />
      </SettingsList>
      {error ? <Notice>{error}</Notice> : null}

      {editing === 'name' ? (
        <RenameGroupSheet initial={group.name} onClose={() => setEditing(null)} save={(name) => save(name, group.timeZone)} />
      ) : null}
      <TimeZoneSheet
        visible={editing === 'timeZone'}
        value={group.timeZone}
        onClose={() => setEditing(null)}
        onPick={async (timeZone) => {
          setEditing(null);
          if (timeZone === group.timeZone) return;
          setError(await save(group.name, timeZone));
        }}
      />
    </>
  );
}

function RenameGroupSheet({
  initial,
  onClose,
  save,
}: {
  initial: string;
  onClose: () => void;
  save: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const invalid = validateGroupName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const failed = await save(name);
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      title="Group name"
      footer={
        <>
          <Button label="Save name" size="lg" loading={busy} onPress={submit} />
          <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
        </>
      }>
      <TextField
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        error={error}
        maxLength={NAME_MAX}
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Sheet>
  );
}
