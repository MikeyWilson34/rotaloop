# Rotaloop

Mobile-first app for fair rotation of shared group responsibilities (initial audience: church volunteer teams). "Rotaloop" is a working name — keep the app name in a single config constant.

- Product brief (source of truth): `docs/product-brief.md`
- Stack: React Native via Expo (iOS, Android, web) + Supabase (Postgres, auth, row-level security per group, realtime)
- Design system & prototype: `design/`

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
