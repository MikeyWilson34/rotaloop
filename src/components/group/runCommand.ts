import type { ClientCommand } from '@/lib/groupCommand';
import type { GroupAction } from '@/lib/groupErrors';

/** Runs a command; resolves to a plain-language error, or null when it worked. */
export type RunCommand = (command: ClientCommand, action: GroupAction) => Promise<string | null>;
