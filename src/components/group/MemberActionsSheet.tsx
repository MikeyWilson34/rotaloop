import { Link, Pencil, Shield, ShieldOff, UserMinus } from 'lucide-react-native';
import { useState } from 'react';

import { ActionRow, Button, Notice, SettingsList, Sheet, TextField } from '@/components/ui';
import type { ClientCommand } from '@/lib/groupCommand';
import type { GroupAction } from '@/lib/groupErrors';
import type { MemberRowView } from '@/lib/groupViews';

/** Runs a command; resolves to a plain-language error, or null when it worked. */
export type RunCommand = (command: ClientCommand, action: GroupAction) => Promise<string | null>;

type Mode = 'menu' | 'rename' | 'remove';

/** An Admin's actions for one Member (Members tab). Mounted only while open. */
export function MemberActionsSheet({
  member,
  groupName,
  run,
  onClose,
  onShareClaimLink,
}: {
  member: MemberRowView;
  groupName: string;
  run: RunCommand;
  onClose: () => void;
  /** Opens the Placeholder's personal invite link. */
  onShareClaimLink: () => void;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState(member.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = member.isMe ? 'you' : member.name;

  async function act(command: ClientCommand, action: GroupAction) {
    setBusy(true);
    setError(null);
    const failed = await run(command, action);
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  if (mode === 'rename') {
    const save = () => {
      const trimmed = name.trim();
      if (!trimmed) {
        setError('Enter a name.');
        return;
      }
      act({ type: 'renameMember', memberId: member.id, name: trimmed }, 'rename');
    };
    return (
      <Sheet
        visible
        busy={busy}
        onClose={onClose}
        overline={groupName}
        title={member.isMe ? 'Your name in this group' : `Rename ${member.name}`}
        footer={
          <>
            <Button label="Save name" size="lg" loading={busy} onPress={save} />
            <Button label="Cancel" variant="quiet" disabled={busy} onPress={() => setMode('menu')} />
          </>
        }>
        <TextField
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          maxLength={80}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />
        {error ? <Notice>{error}</Notice> : null}
      </Sheet>
    );
  }

  if (mode === 'remove') {
    return (
      <Sheet
        visible
        busy={busy}
        onClose={onClose}
        overline={groupName}
        title={`Remove ${member.name}?`}
        message={
          member.isPlaceholder
            ? `${member.name} will be taken out of every Rotation and their upcoming turns move to the next in line. Their history stays.`
            : `${member.name} will lose access to this group. Their upcoming turns move to the next in line, and their history stays. They can rejoin with an invite link.`
        }
        footer={
          <>
            <Button
              label="Remove from group"
              size="lg"
              variant="destructive"
              loading={busy}
              onPress={() => act({ type: 'removeMember', memberId: member.id }, 'removeMember')}
            />
            <Button label="Cancel" variant="quiet" disabled={busy} onPress={() => setMode('menu')} />
          </>
        }>
        {error ? <Notice>{error}</Notice> : null}
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={groupName}
      title={member.isMe ? `${member.name} (you)` : member.name}
      message={
        member.isPlaceholder
          ? "Not joined yet. Send them their personal invite link: joining with it keeps their place and history."
          : member.isAdmin
            ? 'Admin'
            : 'Member'
      }
      footer={<Button label="Close" variant="quiet" disabled={busy} onPress={onClose} />}>
      <SettingsList>
        {member.isPlaceholder ? (
          <ActionRow icon={Link} label="Share personal invite link" onPress={onShareClaimLink} disabled={busy} />
        ) : null}
        {!member.isPlaceholder && !member.isAdmin ? (
          <ActionRow
            icon={Shield}
            label="Make Admin"
            description={`Lets ${who === 'you' ? 'you' : member.name} manage the group, its Members and settings.`}
            onPress={() => act({ type: 'setAdmin', memberId: member.id, isAdmin: true }, 'appointAdmin')}
            disabled={busy}
          />
        ) : null}
        {member.isAdmin ? (
          <ActionRow
            icon={ShieldOff}
            label={member.isMe ? 'Step down as Admin' : 'Remove as Admin'}
            description={member.isMe ? "You'll stay a Member." : `${member.name} stays a Member.`}
            onPress={() =>
              act({ type: 'setAdmin', memberId: member.id, isAdmin: false }, member.isMe ? 'stepDown' : 'removeMember')
            }
            disabled={busy}
          />
        ) : null}
        <ActionRow icon={Pencil} label="Rename" onPress={() => setMode('rename')} disabled={busy} />
        {!member.isMe ? (
          <ActionRow
            icon={UserMinus}
            label="Remove from group"
            destructive
            onPress={() => {
              setError(null);
              setMode('remove');
            }}
            disabled={busy}
          />
        ) : null}
      </SettingsList>
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}

