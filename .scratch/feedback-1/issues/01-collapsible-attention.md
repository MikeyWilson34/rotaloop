# 01 Collapsible "Needs your attention"
Status: resolved

Home's "Needs your attention" section (`src/app/(tabs)/index.tsx`, `SectionHead`, `src/components/home/`) can be collapsed/expanded by tapping its header.
- Chevron + accessible toggle (`aria-expanded` on web, accessibilityState on native).
- Collapsed shows the item count so nothing is hidden silently.
- Remember the choice per device (AsyncStorage, wrapped so failure falls back to expanded).
- Default expanded.

## Answer

- `src/components/home/parts.tsx`: `SectionHead` takes an optional `collapse: { collapsed, onToggle }`. With it, the title, count badge and a chevron (down when open, turned right when collapsed) become one button inside a header, with `accessibilityState={{ expanded }}` plus `aria-expanded`, a label that includes the count ("Needs your attention, 3 items") and a show/hide hint. Without `collapse` it renders exactly as before.
- `src/home/attentionCollapse.ts` (pure, storage passed in like `activity/lastSeenStore.ts`): key `rotaloop.home.attentionCollapsed`, `parseCollapsed` (anything but `"collapsed"` means expanded), `loadAttentionCollapsed` / `saveAttentionCollapsed` that swallow storage errors (read failure → expanded), and `collapsedSummary(count)`.
- `src/home/useAttentionCollapsed.ts`: binds it to AsyncStorage; starts expanded, applies the stored value once read, and never overrides a tap made before the read finished.
- `src/app/(tabs)/index.tsx`: Home uses the toggle. Collapsed, the header keeps its count badge and a line below says "3 items hidden. Tap the heading to show them." (or "You're all caught up." when there are none).
- Tests: `src/home/tests/attentionCollapse.test.ts`.

Decision: the setting is per device, not per account (one key, no user id), as the ticket says.
