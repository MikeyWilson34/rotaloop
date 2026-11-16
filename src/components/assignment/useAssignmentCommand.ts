import { useCallback, useState } from 'react';

import { runGroupCommand, type ClientCommand } from '@/lib/groupCommand';
import { groupCommandMessage, type GroupAction } from '@/lib/groupErrors';
import { fetchGroup } from '@/lib/groups';
import { coveredByName } from '@/coverage/sheets';

export type SendResult = { ok: true } | { ok: false; message: string };

/**
 * Sends one Assignment command and reloads the Group. `busy` disables every button while it
 * runs; Realtime and the reload bring the final state. A lost Cover race is re-fetched to say
 * who won: "Already covered by Cal."
 */
export function useAssignmentCommand(groupId: string, myMemberId: string, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (command: ClientCommand, action: GroupAction): Promise<SendResult> => {
      setBusy(true);
      try {
        const result = await runGroupCommand(groupId, command);
        if (result.ok) {
          await reload();
          return { ok: true };
        }
        let message = groupCommandMessage(result.reason, action);
        if (result.reason === 'alreadyCovered' && 'assignmentId' in command) {
          try {
            const fresh = await fetchGroup(groupId);
            const name = coveredByName(fresh.state, command.assignmentId, myMemberId);
            if (name) message = name === 'you' ? 'You already covered this.' : `Already covered by ${name}.`;
          } catch {
            // keep the general message
          }
          void reload();
        }
        return { ok: false, message };
      } finally {
        setBusy(false);
      }
    },
    [groupId, myMemberId, reload],
  );

  return { send, busy };
}
