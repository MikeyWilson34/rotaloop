import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Linking, View } from 'react-native';

import { Button, Notice, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * In-app QR scanner (native only; the join screen hides it on web). Calls `onScanned` once
 * with the first QR code's text.
 */
export function QrScanner({ onScanned, onCancel }: { onScanned: (data: string) => void; onCancel: () => void }) {
  const { colors, radii, space } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={{ gap: space.md }}>
        <Notice tone="info">
          {permission.canAskAgain
            ? 'To scan an invite QR code, allow camera access. The camera is only used while this screen is open.'
            : 'Camera access is off for this app. Turn it on in Settings, or paste the link instead.'}
        </Notice>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={requestPermission} />
        ) : (
          <Button label="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
        )}
        <Button label="Cancel" variant="quiet" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          width: '100%',
          aspectRatio: 1,
          borderRadius: radii.lg,
          overflow: 'hidden',
          backgroundColor: colors.navy,
        }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => {
            if (done.current) return;
            done.current = true;
            onScanned(result.data);
          }}
        />
      </View>
      <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center' }}>
        Point your camera at the invite QR code.
      </Text>
      <Button label="Cancel" variant="quiet" onPress={onCancel} />
    </View>
  );
}
