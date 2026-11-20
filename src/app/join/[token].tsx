import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { PersonAvatar } from '@/components/group/PersonAvatar';
import { Button, Card, FormScreen, Notice, Text } from '@/components/ui';
import { firstName } from '@/lib/groupPage';
import { parseInviteToken, standInsByMatch } from '@/lib/invite';
import {
  fetchJoinStandIns,
  INVITE_INVALID,
  InvitePreviewError,
  previewInvite,
  type InvitePreview,
  type JoinStandIn,
} from '@/lib/inviteLinks';
import { joinGroup } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import { clearPendingInvite, setPendingInvite } from '@/lib/pendingInvite';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

type State =
  | { kind: 'loading' }
  /** `standIns`: "Are you one of these?" on a join link, closest name first (empty: don't ask). */
  | { kind: 'ready'; preview: InvitePreview; standIns: JoinStandIn[] }
  | { kind: 'invalid'; message: string }
  | { kind: 'offline'; message: string };

/** "No, I'm new" in the "Are you one of these?" list. */
const NEW = 'new';

/**
 * An invite link's landing screen (`<web url>/join/<token>` or `<scheme>://join/<token>`):
 * which Group it is, who you'll join as for a personal link, then Join. On the Group's join
 * link, when the Group has Stand-ins, it first asks "Are you one of these?" so a person
 * someone added by name takes over their turns instead of joining twice (feedback-2 ticket 05).
 */
export default function JoinTokenScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = parseInviteToken(raw ?? '');
  const { gate, profile } = useSession();
  // Signed out (a web visitor opening a shared link): show the Group, then make a guest account.
  const signedOut = gate === 'auth';
  const myName = profile?.display_name?.trim() || '';
  const { space, colors } = useTheme();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  /** A Stand-in's id, NEW, or null (nothing picked yet). */
  const [pick, setPick] = useState<string | null>(null);

  // In the app this invite is being handled now: don't resume it again later. Signed out, the
  // root layout keeps it so it resumes after sign-up and onboarding.
  useEffect(() => {
    if (!signedOut) clearPendingInvite();
  }, [signedOut]);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'invalid', message: INVITE_INVALID });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const preview = await previewInvite(token);
      setState({ kind: 'ready', preview, standIns: await standInsFor(preview) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState(e instanceof InvitePreviewError && e.kind === 'invalid' ? { kind: 'invalid', message } : { kind: 'offline', message });
    }
    // Only a signed-in person about to join through the Group's join link is asked.
    async function standInsFor(preview: InvitePreview): Promise<JoinStandIn[]> {
      if (signedOut || preview.alreadyMember || preview.placeholderName || !token) return [];
      return standInsByMatch((await fetchJoinStandIns(token)) ?? [], myName);
    }
  }, [token, signedOut, myName]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  function openGroup(groupId: string) {
    router.replace({ pathname: '/group/[groupId]', params: { groupId } });
  }

  function leave() {
    if (signedOut) {
      clearPendingInvite();
      router.replace('/welcome');
    } else if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  function getStarted() {
    if (token) setPendingInvite(token);
    router.replace('/welcome');
  }

  async function join() {
    if (!token) return;
    setJoining(true);
    setJoinError(null);
    const standInId = pick && pick !== NEW ? pick : undefined;
    const result = await joinGroup(token, myName || 'Member', standInId);
    setJoining(false);
    if (result.ok) {
      openGroup(result.groupId);
      return;
    }
    if (result.reason === 'alreadyMember' && result.groupId) {
      openGroup(result.groupId);
      return;
    }
    if (result.reason === 'invalidInvite') {
      setState({ kind: 'invalid', message: groupCommandMessage(result.reason, 'join') });
      return;
    }
    if (result.reason === 'standInTaken' && state.kind === 'ready') {
      // Someone else joined as that person first: show who's left and let them pick again.
      const left = standInsByMatch((await fetchJoinStandIns(token)) ?? [], myName);
      setState({ ...state, standIns: left });
      setPick(null);
    }
    setJoinError(groupCommandMessage(result.reason, 'join'));
  }

  let content: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (state.kind === 'loading') {
    content = (
      <View style={{ paddingVertical: space.huge }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (state.kind === 'invalid') {
    content = <Notice>{state.message}</Notice>;
    footer = (
      <>
        {signedOut ? (
          <Button label="Continue without joining" size="lg" onPress={leave} />
        ) : (
          <>
            <Button label="Paste a different link" size="lg" onPress={() => router.replace('/join')} />
            <Button label="Go to Groups" variant="quiet" onPress={() => router.replace('/groups')} />
          </>
        )}
      </>
    );
  } else if (state.kind === 'offline') {
    content = <Notice>{state.message}</Notice>;
    footer = (
      <>
        <Button label="Try again" size="lg" onPress={load} />
        <Button label="Cancel" variant="quiet" onPress={leave} />
      </>
    );
  } else if (state.standIns.length > 0) {
    const { preview, standIns } = state;
    const picked = standIns.find((s) => s.id === pick);
    content = (
      <>
        <Card style={{ gap: space.md, alignItems: 'flex-start' }}>
          <GroupTile groupId={preview.groupId} size={56} />
          <Text variant="overline" color="textSecondary">
            {"You're invited to"}
          </Text>
          <Text variant="title2">{preview.groupName}</Text>
        </Card>
        <View style={{ gap: space.xs }}>
          <Text variant="title3" accessibilityRole="header">
            Are you one of these?
          </Text>
          <Text color="textSecondary">
            {"Someone in the group added these people by name. If one is you, you'll take over their turns."}
          </Text>
        </View>
        <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
          {standIns.map((s) => (
            <PickRow
              key={s.id}
              name={s.name}
              label={s.name}
              detail="Added by name"
              selected={pick === s.id}
              disabled={joining}
              onPress={() => setPick(s.id)}
            />
          ))}
          <PickRow
            label="No, I'm new"
            detail={`Join as ${myName || 'yourself'}`}
            selected={pick === NEW}
            disabled={joining}
            onPress={() => setPick(NEW)}
          />
        </View>
        {joinError ? <Notice>{joinError}</Notice> : null}
      </>
    );
    footer = (
      <>
        <Button
          label={picked ? `Join as ${firstName(picked.name)}` : `Join ${preview.groupName}`}
          size="lg"
          loading={joining}
          disabled={pick === null}
          onPress={join}
        />
        <Button label="Not now" variant="quiet" disabled={joining} onPress={leave} />
      </>
    );
  } else {
    const { preview } = state;
    content = (
      <>
        <Card style={{ gap: space.md, alignItems: 'flex-start' }}>
          <GroupTile groupId={preview.groupId} size={56} />
          <Text variant="overline" color="textSecondary">
            {"You're invited to"}
          </Text>
          <Text variant="title2">{preview.groupName}</Text>
          {preview.alreadyMember ? (
            <Text color="textSecondary">{"You're already a Member of this group."}</Text>
          ) : preview.placeholderName ? (
            <Text color="textSecondary">
              {`You'll join as ${preview.placeholderName}. Someone in the group added you by that name, so you keep your place and history.`}
            </Text>
          ) : (
            <Text color="textSecondary">
              {signedOut
                ? "First, tell us your name. No email or password: your account lives on this device. Then you'll join."
                : `You'll join as ${myName || 'yourself'}.`}
            </Text>
          )}
        </Card>
        {joinError ? <Notice>{joinError}</Notice> : null}
      </>
    );
    footer = signedOut ? (
      <>
        <Button label="Get started" size="lg" onPress={getStarted} />
        <Button label="Not now" variant="quiet" onPress={leave} />
      </>
    ) : preview.alreadyMember ? (
      <>
        <Button label="Open group" size="lg" onPress={() => openGroup(preview.groupId)} />
        <Button label="Cancel" variant="quiet" onPress={leave} />
      </>
    ) : (
      <>
        <Button label={`Join ${preview.groupName}`} size="lg" loading={joining} onPress={join} />
        <Button label="Not now" variant="quiet" disabled={joining} onPress={leave} />
      </>
    );
  }

  return (
    <FormScreen onBack={leave} title="Join a group" footer={footer}>
      {content}
    </FormScreen>
  );
}

/** One answer to "Are you one of these?": a radio row, with the person's avatar for a Stand-in. */
function PickRow({
  name,
  label,
  detail,
  selected,
  disabled,
  onPress,
}: {
  /** A Stand-in's name, for the avatar. */
  name?: string;
  label: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, radii, space, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected, disabled: !!disabled }}
      aria-checked={selected}
      accessibilityLabel={label}
      accessibilityHint={detail}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 64,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radii.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
      })}>
      {name ? <PersonAvatar name={name} dashed /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
          {label}
        </Text>
        <Text variant="subhead" color="textSecondary" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {selected ? <Check size={22} color={colors.primary} strokeWidth={2} /> : null}
    </Pressable>
  );
}
