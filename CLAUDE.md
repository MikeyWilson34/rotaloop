# Rotaloop

Mobile-first app for fair rotation of shared group responsibilities (initial audience: church volunteer teams). "Rotaloop" is a working name — keep the app name in a single config constant.

- Product brief (source of truth): `docs/product-brief.md`
- Stack: React Native via Expo (iOS, Android, web) + Supabase (Postgres, auth, row-level security per group, realtime)
- Design system & prototype: `design/`

## Working mode: orchestrator

The main session plans and delegates. It does not write app code.

- Main session: talk with the user, write specs and tickets in `.scratch/`, review worker output, make integration decisions, commit.
- Delegate implementation (app code, prototypes, migrations, tests) to **Orca workers**, not in-chat subagents, so the user can watch and talk to each one in Orca:
  `orca orchestration worker-start --spec "<brief>" --worktree current --agent claude --keep-open`
  Load the `orchestration` skill first for the full protocol.
- Independent tickets that could touch the same files get their own child workspace (`--worktree new-child --name <ticket>`).
- One worker per real ticket, not many tiny ones. Use a cheaper model (`--model sonnet`) for simple, well-specified tickets; keep the strongest model for hard work and planning.
- In-chat subagents (Agent tool) are only for quick read-only lookups.
- Each worker brief is self-contained: files to read, deliverable, what it may edit, acceptance checks, what to report back.
- Verify a worker's result before reporting it done (tests, `e2e:nav` after UI deploys, or inspecting the output).

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
