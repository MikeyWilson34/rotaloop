# 06 Groups, invites, Admins, Placeholders
Status: resolved
Blocked by: 04, 05

Create Group (creator = Admin), invite link + QR, join directly, reset link, appoint/remove Admins, remove Members (triggers engine close-up), add Placeholder Members, personal claim link.

## Answer
**Routes**
- `(tabs)/groups`: the person's Groups as cards (accent tile, name, next Event or "No Events yet", "Admin" pill), sorted by soonest Event and then by name. Includes an empty state, "Create a group", "Join with an invite link", and pull to refresh.
- `/create-group`: name plus time zone (the device's by default; a searchable sheet uses `Intl.supportedValuesOf('timeZone')` with a fallback list). It calls `createGroup` and lands on the new Group.
- `/group/[groupId]?tab=overview|schedule|members|settings`: header (tile, name, Member count, "You're an Admin"/"Member" pill, invite button) and a segmented control.
  - **Overview** shows the "Next: add Responsibilities" empty state with a disabled button (ticket 07). **Schedule** is a placeholder (08).
  - **Members:** Admins first; Admin and "Not joined yet" badges; "Qualified: …" from the Rotation queues; former Members hidden; a comment marks the slot for workload bars (08). Admins tap a Member for a sheet: Make Admin / Remove as Admin / Step down (`setAdmin`), Rename (`renameMember`), Remove from group (with an in-sheet confirm), and for Placeholders "Share personal invite link" (`claim_link_for`, QR included). Admins can also add a Placeholder Member (`addMember`).
  - **Settings (membership):** Members, time zone, Admins, Share / Reset invite link (with a confirm), and Leave group (with a confirm). Every refusal, including `lastAdmin`, shows in plain words.
- `/join`: paste a link, or scan the QR in-app (`expo-camera`, native only; hidden on web).
- `/join/[token]`: preview via `invite_link_preview` (group name; "You'll join as <Placeholder>" for claim links; "You're already a Member" plus Open group), then Join with `joinGroup(token, display name)` and land on the Group. Invalid or reset links, offline, `alreadyMember` and `invalidInvite` are all handled.

**Invite links** are `${EXPO_PUBLIC_WEB_URL}/join/<token>`. `WEB_URL` is in `src/config/app.ts` (default `https://rotaloop.expo.app`, documented in `.env.example`), and the QR encodes the same URL. `parseInviteToken` accepts the https link, `rotaloop://join/<token>`, any URL ending in `/join/<token>` (trailing slash, query or hash allowed), a bare token, or a token anywhere in pasted text.

**Pending invites** (`src/lib/pendingInvite.ts`, kept in memory and in AsyncStorage):
- The root layout reads `Linking.useLinkingURL()`. A `/join/<token>` URL opened while signed out, mid-onboarding or still loading is remembered.
- Onboarding's join step is preselected and prefilled with it. "Continue" keeps the token and finishes onboarding, then `resumeInviteRoute` opens `/join/<token>`.
- "I'll do this later" and "Create a group" drop the token. In the app, expo-router opens `/join/<token>` directly. The join screen clears the token when it opens.
- Verified on the web export: a signed-out load of `/join/<token>` lands on `/welcome` with the token kept.

**Data:** `src/lib/groups.ts`. `useMyGroups` reads members joined to groups plus upcoming events. `useGroup` calls `group_state_rows` and then `stateFromRows`, and subscribes to Realtime on `groups`/`members` for the open Group (debounced reload). Both hooks expose loading, error, `refresh` (pull) and `reload` (quiet), and reload on focus. Pure view logic is in `src/lib/groupViews.ts`. Rejection messages are in `src/lib/groupErrors.ts` (`groupCommandMessage(reason, action)`), and the RPC wrappers are in `src/lib/inviteLinks.ts`.

**UI added:** `Sheet` (ConfirmSheet now uses it and gained `error`), `SegmentedControl`, `Badge`, `Avatar`, `ActionRow`, `InfoRow`; plus `components/group/*` and `components/join/QrScanner`.

**Libraries:** `react-native-qrcode-svg` (on the existing `react-native-svg`; renders on web), `expo-clipboard`, and `expo-camera` (config plugin with the camera permission text; microphone off).

**Tests:** `src/lib/tests/invite.test.ts`, `groupErrors.test.ts`, `groupViews.test.ts`, plus new gate cases. 231 tests in total. Typecheck, lint and `expo export --platform web` all pass.

**Live check:** `node --env-file=.env scripts/smoke-groups.mjs` against the hosted project. Every step passed: create, add Pat, Group link and claim link, B previews and joins, a repeat join is refused with `alreadyMember`, A appoints B, A leaves, B stepping down is refused with `lastAdmin`, B gets Pat's link, C claims Pat, and the claim link is then spent. The data is left in Groups named "Smoke Test 06 …".

**Backend gaps (not changed):**
1. Only Admins can read `invite_links`, so Members can't share the Group link (the app tells them to ask an Admin). If Members should share it: add a `group_invite_link(p_group_id)` security-definer RPC that checks `is_group_member`.
2. `invite_link_preview` is granted only to `authenticated`, so a signed-out web visitor can't see the group name before making a guest account. Proposed: `grant execute on function public.invite_link_preview(text) to anon;`.
3. For https links to open the installed native app, iOS associated domains and Android App Links (plus `apple-app-site-association`/`assetlinks.json` on the web domain) belong to the hosting ticket.
