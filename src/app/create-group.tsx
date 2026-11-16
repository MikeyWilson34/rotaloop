import { router } from 'expo-router';

import { Button, FormScreen, Notice } from '@/components/ui';

/** Placeholder until group creation lands (ticket 06). */
export default function CreateGroupScreen() {
  function goHome() {
    router.replace('/');
  }
  return (
    <FormScreen
      onBack={() => (router.canGoBack() ? router.back() : goHome())}
      title="Create a group"
      lead="Name it, add Responsibilities, invite people. You'll be its first Admin."
      footer={<Button label="Go to Home" size="lg" onPress={goHome} />}>
      <Notice tone="info">
        {"Creating a group arrives in the next update. We'll bring you right back here."}
      </Notice>
    </FormScreen>
  );
}
