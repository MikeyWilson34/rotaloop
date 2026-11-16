import { Button } from './Button';
import { Notice } from './Notice';
import { Sheet } from './Sheet';

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` paints the confirm button red (for things that can't be undone). */
  tone?: 'default' | 'destructive';
  /** Shows a spinner on the confirm button and blocks closing while the action runs. */
  loading?: boolean;
  /** A plain-language error from the last attempt, shown above the buttons. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A bottom sheet that asks before doing something. Works the same on iOS, Android and web,
 * so web never falls back to `window.confirm`.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  loading,
  error,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title={title}
      message={message}
      busy={loading}
      closeLabel={cancelLabel}
      footer={
        <>
          <Button
            label={confirmLabel}
            size="lg"
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            loading={loading}
            onPress={onConfirm}
          />
          <Button label={cancelLabel} variant="quiet" disabled={loading} onPress={onCancel} />
        </>
      }>
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
