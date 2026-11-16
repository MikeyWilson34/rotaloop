import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Notice, Sheet, Text } from '@/components/ui';
import { inviteUrl } from '@/lib/invite';
import { copyText, shareLink } from '@/lib/share';
import { useTheme } from '@/theme';

export type InviteSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The Group's name (eyebrow and share message). */
  groupName: string;
  title: string;
  message: string;
  /** Fetches the token to share. Throw with a plain-language message on failure. */
  loadToken: () => Promise<string>;
  /** Admins: replaces the link (the old one stops working). Returns the new token. */
  resetToken?: () => Promise<string>;
  /** The text sent with the link by Share. */
  shareMessage: string;
};

/**
 * An invite link with its QR code, Copy and Share (prototype invite sheet). Used for the
 * Group's join link and for a Placeholder's personal claim link.
 */
export function InviteSheet(props: InviteSheetProps) {
  // Mounted only while open, so each opening fetches a fresh link.
  if (!props.visible) return null;
  return <InviteSheetBody {...props} />;
}

function InviteSheetBody({
  onClose,
  groupName,
  title,
  message,
  loadToken,
  resetToken,
  shareMessage,
}: InviteSheetProps) {
  const { colors, radii, space, fonts } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let current = true;
    loadToken().then(
      (t) => current && setToken(t),
      (e: unknown) => current && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      current = false;
    };
    // Load once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = token ? inviteUrl(token) : null;

  async function copy() {
    if (!url) return;
    setStatus((await copyText(url)) ? 'Link copied.' : "Couldn't copy. Press and hold the link to copy it.");
  }

  async function share() {
    if (!url) return;
    const result = await shareLink(url, shareMessage);
    if (result === 'copied') setStatus('Link copied. Paste it wherever you like.');
    if (result === 'failed') setStatus("Couldn't open sharing. Use Copy instead.");
  }

  async function reset() {
    if (!resetToken) return;
    setResetting(true);
    setError(null);
    try {
      setToken(await resetToken());
      setStatus('New link ready. The old link no longer works.');
      setConfirmingReset(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  if (confirmingReset) {
    return (
      <Sheet
        visible
        onClose={() => setConfirmingReset(false)}
        busy={resetting}
        overline={groupName}
        title="Reset the invite link?"
        message="The current link and QR code will stop working right away. People who already joined stay in the group. You'll get a new link to share."
        closeLabel="Keep the current link"
        footer={
          <>
            <Button label="Reset link" size="lg" variant="destructive" loading={resetting} onPress={reset} />
            <Button
              label="Keep the current link"
              variant="quiet"
              disabled={resetting}
              onPress={() => setConfirmingReset(false)}
            />
          </>
        }>
        {error ? <Notice>{error}</Notice> : null}
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      overline={groupName}
      title={title}
      message={message}
      footer={<Button label="Done" variant="quiet" onPress={onClose} />}>
      {error ? <Notice>{error}</Notice> : null}
      {!url && !error ? (
        <View style={{ height: 200, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {url ? (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel="QR code for the invite link"
            style={{
              alignSelf: 'center',
              padding: 12,
              backgroundColor: '#FFFFFF',
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            {/* Always dark on white so every camera can read it, in dark mode too. */}
            <QRCode value={url} size={184} color="#1F2D45" backgroundColor="#FFFFFF" ecl="M" />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              padding: space.sm,
              paddingLeft: space.md,
              borderRadius: radii.md,
              backgroundColor: colors.surfaceAlt,
            }}>
            <Text
              variant="subhead"
              selectable
              numberOfLines={2}
              style={{ flex: 1, fontFamily: fonts.bold }}
              accessibilityLabel="Invite link">
              {url}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Copy link" style={{ flex: 1 }} onPress={copy} />
            <Button label="Share" variant="secondary" style={{ flex: 1 }} onPress={share} />
          </View>
          {status ? (
            <Text variant="subhead" color="successText" accessibilityLiveRegion="polite">
              {status}
            </Text>
          ) : null}
          {resetToken ? (
            <Button
              label="Reset link"
              variant="quiet"
              onPress={() => {
                setStatus(null);
                setConfirmingReset(true);
              }}
              accessibilityHint="Makes a new link. The current one stops working."
            />
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

