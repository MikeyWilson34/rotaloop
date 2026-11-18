# 01 Collapsible "Needs your attention"
Status: ready-for-agent

Home's "Needs your attention" section (`src/app/(tabs)/index.tsx`, `SectionHead`, `src/components/home/`) can be collapsed/expanded by tapping its header.
- Chevron + accessible toggle (`aria-expanded` on web, accessibilityState on native).
- Collapsed shows the item count so nothing is hidden silently.
- Remember the choice per device (AsyncStorage, wrapped so failure falls back to expanded).
- Default expanded.
