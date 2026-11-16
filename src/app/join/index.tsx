import { router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { QrScanner } from '@/components/join/QrScanner';
import { Button, FormScreen, Notice, TextField } from '@/components/ui';
import { NOT_AN_INVITE, parseInviteToken } from '@/lib/invite';

/** Join with an invite link: paste it, or scan its QR code (native only). */
export default function JoinScreen() {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const canScan = Platform.OS !== 'web';

  function open(text: string): boolean {
    const token = parseInviteToken(text);
    if (!token) return false;
    router.replace({ pathname: '/join/[token]', params: { token } });
    return true;
  }

  function submit() {
    if (!open(link)) setError(NOT_AN_INVITE);
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  if (scanning) {
    return (
      <FormScreen onBack={() => setScanning(false)} title="Scan invite QR code">
        {scanError ? <Notice>{scanError}</Notice> : null}
        <QrScanner
          key={scanKey}
          onScanned={(data) => {
            if (open(data)) return;
            setScanError("That QR code isn't an invite link. Try another one.");
            setScanKey((k) => k + 1);
          }}
          onCancel={() => setScanning(false)}
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      onBack={back}
      title="Join a group"
      lead="Paste the invite link someone sent you, or scan their QR code."
      footer={
        <>
          <Button label="Continue" size="lg" disabled={!link.trim()} onPress={submit} />
          {canScan ? (
            <Button
              label="Scan a QR code"
              variant="secondary"
              size="lg"
              onPress={() => {
                setScanError(null);
                setScanning(true);
              }}
              accessibilityHint="Opens the camera"
            />
          ) : null}
        </>
      }>
      <TextField
        label="Invite link"
        value={link}
        onChangeText={(text) => {
          setLink(text);
          if (error) setError(null);
        }}
        error={error}
        placeholder="Paste invite link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
    </FormScreen>
  );
}
