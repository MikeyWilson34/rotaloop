import { useMemo, useState } from 'react';

import { JobRow } from '@/components/setup/JobRow';
import { RepeatSheet, TimeSheet } from '@/components/setup/JobSheets';
import { Button, ConfirmSheet, Notice, Sheet, showToast } from '@/components/ui';
import { newJobDraft, type JobDraft } from '@/lib/groupCreate';
import { checkJob, deleteJobCommands, jobEditCommands, newJobCommands, type JobView } from '@/lib/groupPage';
import { todayIn } from '@/lib/groupSetup';
import type { GroupDetails } from '@/lib/groups';

import type { RunCommand } from './runCommand';

/**
 * Edit a job, or add one (prototype `SHEETS.job`): the same sentence row as setup,
 * `[Greeter] · [every Sunday ▾] · [10:00am]`. Saving refills the turns; deleting removes its
 * upcoming dates (history stays). Only one sheet shows at a time, so picking how often or what
 * time hides this one for a moment.
 */
export function JobEditSheet({
  group,
  job,
  run,
  onClose,
}: {
  group: GroupDetails;
  /** null: a new job. */
  job: JobView | null;
  run: RunCommand;
  onClose: () => void;
}) {
  const today = useMemo(() => todayIn(group.timeZone, new Date()), [group.timeZone]);
  const [draft, setDraft] = useState<JobDraft>(() => job?.draft ?? newJobDraft(today));
  const [picking, setPicking] = useState<'repeat' | 'time' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAll(commands: Parameters<RunCommand>[0][], action: Parameters<RunCommand>[1]): Promise<boolean> {
    for (const command of commands) {
      const failed = await run(command, action);
      if (failed) {
        setError(failed);
        return false;
      }
    }
    return true;
  }

  async function save() {
    const now = new Date();
    const check = checkJob(group.state, draft, job?.responsibilityId ?? null, group.timeZone, now);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const commands = job
      ? jobEditCommands(group.state, job, draft, group.timeZone, now)
      : newJobCommands(group.state, draft, group.timeZone, now);
    if (commands.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await runAll(commands, job ? 'saveSeries' : 'saveResponsibility');
    setBusy(false);
    if (!ok) return;
    onClose();
    showToast(job ? 'Job saved' : 'Job added. Turns are filled in.');
  }

  async function remove() {
    if (!job) return;
    setBusy(true);
    setError(null);
    const ok = await runAll(deleteJobCommands(job), 'removeResponsibility');
    setBusy(false);
    if (!ok) {
      setPicking(null);
      return;
    }
    onClose();
    showToast('Job deleted');
  }

  return (
    <>
      <Sheet
        visible={picking === null}
        busy={busy}
        onClose={onClose}
        overline={group.name}
        title={job ? 'Edit job' : 'Add a job'}
        footer={
          <>
            <Button label={job ? 'Save job' : 'Add job'} size="lg" loading={busy} onPress={save} />
            {job ? (
              <Button label="Delete job" variant="quiet" disabled={busy} onPress={() => setPicking('delete')} />
            ) : (
              <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
            )}
          </>
        }>
        <JobRow
          job={draft}
          index={0}
          autoFocus={!job}
          onChange={(next) => {
            setDraft(next);
            setError(null);
          }}
          onPickRepeat={() => setPicking('repeat')}
          onPickTime={() => setPicking('time')}
        />
        {error ? <Notice>{error}</Notice> : null}
      </Sheet>
      <RepeatSheet
        visible={picking === 'repeat'}
        value={draft.repeat}
        today={today}
        onClose={() => setPicking(null)}
        onDone={(repeat) => {
          setDraft((d) => ({ ...d, repeat }));
          setPicking(null);
        }}
      />
      <TimeSheet
        visible={picking === 'time'}
        value={draft.time}
        onClose={() => setPicking(null)}
        onDone={(time) => {
          setDraft((d) => ({ ...d, time }));
          setPicking(null);
        }}
      />
      <ConfirmSheet
        visible={picking === 'delete'}
        title="Delete this job?"
        message="Its upcoming turns are removed. Past turns stay in the history."
        confirmLabel="Delete job"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setPicking(null)}
      />
    </>
  );
}
