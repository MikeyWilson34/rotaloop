# 03 Rename "Qualified Members" to "Team"
Status: resolved

All user-facing copy: "Qualified Members" / "qualified" becomes the Responsibility's team, e.g. "Sound team · 6 people", "Add to Sound team", "Only the Sound team can cover". Update `GLOSSARY.md` (term **Team**: the Members who can be assigned one Responsibility; _Avoid_: Qualified Member, eligible member, trained member; keep "Team" in Group's _Avoid_ list with a note that Team means a Responsibility's team). Update docs/spec wording where it's domain language. Code identifiers may stay as-is (note the mapping in the glossary) unless renaming is trivial. Update tests/scripts that assert on copy.

## Answer

Copy changes (old → new):
- Responsibility screen field label: "Qualified Members" → "Sound team · 6 people" (edit) / "Sound team" or "Team" while the name is blank (add).
- Edit hint: "Tap to add or remove." → "Tap a name to add them to the Sound team or take them off."
- Empty Rotation: "Nobody is Qualified yet, so these seats stay open. Choose Qualified Members above." → "Nobody is on the Sound team yet, so these seats stay open. Add people to the team above."; read-only view "Nobody is Qualified yet." → "Nobody is on the Sound team yet."
- Add hint: "…and choose them later." → "…and add them to the team later."
- Settings Responsibility summary: "2 Qualified Members · …" → "Sound team · 2 people · …" (new pure helper `teamLabel` in `src/lib/groupSetup.ts`).
- Setup checklist: "Choose who's Qualified" → "Choose each team" ("Pick who's on each Responsibility's team. They rotate in order.").
- Members tab row: "Qualified: Sound · Greeter" → "Teams: Sound · Greeter" ("Team:" for one); "Not in a Rotation yet" → "Not on a team yet".
- Decline / cover / mark-covered sheets (`src/coverage/sheets.ts`): "Qualified for Sound" → "On the Sound team"; "No one else is Qualified for Sound yet…" → "No one else is on the Sound team yet…"; "…to everyone Qualified." → "…to the Sound team."; "…and Qualified Members are asked again." → "…and the Sound team is asked again."; "Asked 2 Qualified Members for Sound." → "Asked 2 people on the Sound team."; "We're asking Qualified Members to cover Sound on Sun, Nov 22." → "We're asking the Sound team to cover Sun, Nov 22."
- Errors (`src/lib/groupErrors.ts`): "Only Qualified Members for this Responsibility can cover it. Ask an Admin to add you." → "Only this Responsibility's team can cover it. Ask an Admin to add you to the team."; "…Qualified Members have been asked." → "…The team has been asked."; "That person isn't a Qualified Member for this Responsibility." → "That person isn't on this Responsibility's team." Engine reject messages in `src/engine/commands.ts` updated to match.
- History: "You made Deb a Qualified Member for Sound." → "You added Deb to the Sound team."; "You took Deb out of the Sound Rotation." → "You took Deb off the Sound team."
- Profile notification switch: "…a Responsibility I'm Qualified for" → "…on a team I'm on".

Docs: `GLOSSARY.md` replaces **Qualified Member** with **Team** (with the code-identifier mapping), notes in Group's _Avoid_ that Team means a Responsibility's people, and rewords Admin, Rotation and Cover. `docs/adr/0001-hybrid-queue-rotation.md` wording updated. Tests updated in `src/coverage/tests/sheets.test.ts`, `src/lib/tests/groupErrors.test.ts`, `src/lib/tests/groupSetup.test.ts`, `src/schedule/tests/history.test.ts`; `scripts/e2e-nav.mjs` now taps "Choose each team".

Decisions: code identifiers (`qualified*`, `isQualified`, `notQualified`, `memberNoLongerQualified`), SQL migrations, code comments, test names and the historical `.scratch/mvp` tickets keep the old word. There is no "Add to Sound team" button today (team membership is edited by chips on the Responsibility screen), so that phrasing lives in the chip hint. The cover error has no Responsibility name in scope, so it says "this Responsibility's team" rather than "the Sound team".
