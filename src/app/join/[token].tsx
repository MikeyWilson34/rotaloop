import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { Button, Card, FormScreen, Notice, Text } from '@/components/ui';
import { parseInviteToken } from '@/lib/invite';
import { INVITE_INVALID, InvitePreviewError, previewInvite, type InvitePreview } from '@/lib/inviteLinks';
import { joinGroup } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import { clearPendingInvite, setPendingInvite } from '@/lib/pendingInvite';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: InvitePreview }
  | { kind: 'invalid'; message: string }
  | { kind: 'offline'; message: string };

/**
 * An invite link's landing screen (`<web url>/join/<token>` or `<scheme>://join/<token>`):
 * which Group it is, who you'll join as for a personal link, then Join.
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
      setState({ kind: 'ready', preview: await previewInvite(token) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState(e instanceof InvitePreviewError && e.kind === 'invalid' ? { kind: 'invalid', message } : { kind: 'offline', message });
    }
  }, [token]);

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
    const result = await joinGroup(token, myName || 'Member');
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
              {`You'll join as ${preview.placeholderName}. An Admin added you by that name, so you keep your place and history.`}
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
