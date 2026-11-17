# 12 Home dashboard + Activity
Status: resolved
Blocked by: 09, 10

Home per spec (hero, attention, merged Your groups with Admin stats + filters), Activity feed with filters and unread state.

## Answer
No backend changes. Home and Activity read the existing tables under RLS. The only server command they send is `confirm`, plus `withdrawDecline` from ticket 16, which is deployed.

**Home** (`src/app/(tabs)/index.tsx`, prototype `screenHome`):
- **Greeting:** today's date, "Good morning/afternoon/evening, Alex", and the profile avatar.
- **Hero** (navy): "Next up · In 6 days", the status pill ("You're covering" when covering), Responsibility, long date, time (with the Group's time when it differs), Group, and "With …" avatars. It also shows the moved note and the Make-up Turn note in amber.
  - Pending: Confirm runs inline and shows a toast; Can't make it opens `?action=decline`.
  - Otherwise: "You're all set…" or, for a Responsibility that needs confirmation later, "Nothing to do yet…", with Details.
  - Empty: "You're all clear". With no Groups: a welcome card with "Go to Groups".
- **Needs your attention** (count badge, sorted by Event date, then by urgency; one item per Assignment; "You're all caught up." when empty):
  - Replacement Duty: Mark covered → `?action=markCovered`.
  - Coverage Requests I'm Qualified for and not already seated at that Event: I can cover → `?action=cover`.
  - My open request: "Finding cover for your X · N people asked", with View request and "I can make it after all" (sends `withdrawDecline` inline, behind `CAN_WITHDRAW_DECLINE`).
  - Make-up Turns, moved Assignments and other Pending confirmations (except the hero): inline Confirm and Can't make it.
- **Your groups:** one list sorted by name.
  - Member cards: next Event · Primary Responsibility holder, and "You · Dec 2" with a status pill.
  - Admin cards: an Admin badge and health stats: open coverage (with "finding a replacement"), pending · 3 wks, recent changes (7 days, routine entries excluded) and Skip Dates.
  - Filter chips with counts (All / Managed by me / Needs attention) in `?filter=`. They show only to someone who administers a Group.
- **Quick actions:** Add Time Off (→ /time-off) and Invite someone, which opens the invite sheet for the first Group, or goes to Groups when there is none.

**Activity** (`src/app/(tabs)/activity.tsx`, prototype `screenActivity`):
- `schedule_history` across my Groups, newest first. It leaves out routine entries (`fillSchedule`, and Events added by the daily job), both on the server and in the pure filter.
- Day sections: Today / Yesterday / Earlier this week (Sunday weeks; the weekday is added to the time) / "Sat, Nov 14" (with the year when it isn't this year).
- Each item: the `describeHistoryEntry` sentence plus its detail, an icon and tone per cause, and "● Group · time" (the time never gets truncated).
- Filters in `?filter=`: All / Coverage / Confirmations / Schedule changes.
- "Load more" uses keyset pages of 30. Realtime INSERTs on `schedule_history` for my Groups merge in the newest page. Pull to refresh, skeleton.
- Tapping an item opens the Assignment it's about (if it's still on the schedule), otherwise the Group.

**Unread:**
- "Last seen" is stored per account on the device (`rotaloop.activity.lastSeen.<userId>` in AsyncStorage, which is localStorage on the web). An in-memory store sits in front of it so the badge and the screen agree immediately.
- An entry is unread when it's newer than last seen and not the viewer's own action.
- The first visit on a device starts counting from then.
- Opening Activity marks everything loaded as seen. The dots stay for that visit (it renders against a snapshot taken when the visit started).
- The tab badge (`tabBarBadge`, "99+" cap) recounts on Realtime inserts and whenever last seen changes. The only edit to `(tabs)/_layout.tsx` is this badge.

**Modules:**
- **Pure and tested:**
  - `src/home/home.ts`: `greeting`, `todayLabel`, `selectHero`, `attentionItems` (options `heroKey`, `canWithdraw`), `groupHealth` (`PENDING_WINDOW_DAYS = 21`, `RECENT_CHANGES_DAYS = 7`, `isRoutineHistory`), `groupCards`, `showGroupFilters`/`filterGroupCards`/`groupFilterCounts`/`parseGroupFilter`, and `skipDatesLabel`, `withLabel`, `initialsOf`.
  - `src/activity/feed.ts`: `activityKind`, `activityIcon`, `isFeedWorthy`, `isUnread`, `unreadCount`, `badgeLabel`, `activityTarget`, `activityItems`, `filterActivity`, `dayLabel`, `groupActivityByDay`, `newestAt`, `laterOf`.
  - `src/activity/lastSeenStore.ts`: the storage-agnostic store.
- **Data:**
  - `src/home/data.ts` (`useHomeData`): `useMySchedule` plus three queries for all Groups: Rotations, outstanding Make-up Turns, and 14 days of history.
  - `src/activity/data.ts`: `fetchFeed`, `useActivityFeed`, `useActivityUnreadCount`, `useHistoryRealtime`.
  - `src/activity/lastSeen.ts`: the AsyncStorage binding.
- **UI:** `src/components/home/` (`Hero`, `AttentionCard`, `GroupCards`, `parts`: filter chips with counts, section head, caught-up note, tone icons, skeleton).
- Shared files are unchanged except the tab layout's badge.

**Polish:** pull to refresh, skeletons, dark mode (the hero keeps its own on-navy colours), 48px targets (attention buttons, chips, links, rows), filter chips scroll sideways instead of overflowing, and everything sits in the centred column.

**Tests:** `src/home/tests/home.test.ts` (29) and `src/activity/tests/feed.test.ts` (17). They use the real-engine fixture and cover:
- hero edge cases: none, started Events, my open request skipped, Pending/Confirmed/later/no-confirmation modes, covering, Make-up Turn and moved notes;
- every attention kind, the doubling rule, both Replacement Duty settings, withdraw only when available, and the order;
- health: the 3-week window both ways, recent changes at the 7-day boundary with routine entries excluded, Skip Dates;
- cards and filters;
- activity kinds, icons and noise, unread rules and the count, the last-seen store (forward only, garbage, storage failures), day labels across the week and year, items, filters, sections and targets.

Full suite: 555 passing. `npm run typecheck` and `npm run lint` pass.

**Live:** `node --env-file=.env --import tsx scripts/seed-home.mjs [session-file]`: 43/43 ok. It creates "Smoke Test 12 Sunday Team …" (Alex is Admin; Replacement Duty goes to Admins) and "Smoke Test 12 Hospitality …" (Ben's; Alex is a Member). It sets up:
- Alex's Pending hero;
- Ben's and Casey's Coverage Requests that Alex can cover;
- Dana's declined one-off Setup Event two days out (Replacement Duty for Alex);
- Casey's Skip Date ("Building closed"), which moves later turns and asks for confirmation again;
- confirmations and setup history.

Casey is the plain-Member view, Evan (no turns) shows "all clear / caught up", and Fran is in no Group. Headless Edge screenshots come from a local web export (not deployed): Home (Admin × 3 filters, Member, caught-up, no groups) and Activity × 4 filters, at 390 and 1440, light and dark.

**Follow-ups:**
- Store "last seen" on the server (a profile column) so unread state syncs across devices.
- The badge reads my memberships once per session: joining a Group shows up in the count after a reload.
- "Recent changes" counts every non-routine entry, setup commands included; Admins may want only schedule-affecting ones.
- Moves are detected from the last 14 days of history.
- Activity describes old entries against the loaded state (Events from the start of this month), so very old entries may lack their dates.
- The prototype's reminder timing ("We'll remind you the day before at 8:00 AM") isn't wired to notification prefs: Home says "before the Event".
