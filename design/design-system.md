# Rotaloop Design System (draft v0.1)

> First visual draft for owner review. Direction: **warm, welcoming, modern, practical**. Tokens are written so they map 1:1 to a React Native theme object (`theme.colors.*`, `theme.space.*`, etc.). The clickable prototype at `design/prototype/index.html` uses exactly these values as CSS custom properties.

---

## 1. Color

All text/background pairs below were checked against WCAG 2.1 contrast (AA = 4.5:1 for body text, 3:1 for large text and UI glyphs). Ratios are listed next to each pair.

### 1.1 Light mode

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FAF7F2` | App background (warm off-white) |
| `surface` | `#FFFFFF` | Cards, sheets, tab bar |
| `surfaceAlt` | `#F3EEE6` | Inset areas, segmented control track, input fill |
| `border` | `#E8E1D6` | Card hairlines, dividers (decorative, not text) |
| `borderStrong` | `#D8CFC1` | Input outlines, dashed "skipped" outlines |
| `text` (navy) | `#1F2D45` | Headings, primary text, active nav. 12.9:1 on `bg` |
| `textSecondary` (soft gray) | `#5F6673` | Meta text, labels. 5.4:1 on `bg`, 5.8:1 on `surface` |
| `textTertiary` | `#686E79` | Timestamps, hints. 4.8:1 on `bg` (use on `bg`/`surface` only) |
| `navy` | `#1F2D45` | Hero card fill, active tab. White on navy 13.8:1 |
| `primary` (muted blue) | `#3A6894` | Buttons, links, selected chips. White on it 5.9:1; as text on `bg` 5.5:1 |
| `primaryTint` | `#E5EDF5` | Selected chip bg, info banners. `primary` on it 5.0:1 |
| `success` (sage) | `#4E7D5B` | Filled positive buttons/badges. White on it 4.8:1 |
| `successText` | `#3D6B4A` | Sage text/icons. 6.2:1 on `surface`, 5.2:1 on `successTint` |
| `successTint` | `#E4EEE6` | Confirmed pill bg |
| `warning` (muted amber) | `#C98A2B` | Decorative dots/bars only (not text) |
| `warningText` | `#8A5A0F` | Pending/attention text & icons. 5.9:1 on `surface`, 5.2:1 on tint |
| `warningTint` | `#FBEED6` | Pending pill/banner bg |
| `danger` (muted red) | `#A9483F` | Filled destructive button. White on it 5.7:1 |
| `dangerText` | `#9C3F37` | Declined / needs-coverage text. 6.6:1 on `surface`, 5.3:1 on tint |
| `dangerTint` | `#F7E2DE` | Needs-coverage pill/banner bg |
| `neutralTint` | `#ECEAE6` | Skipped / scheduled pill bg. `textSecondary` on it 4.8:1 |

### 1.2 Dark mode

Warm-leaning charcoal navy instead of pure black, so it still feels "Rotaloop".

| Token | Hex | Notes |
|---|---|---|
| `bg` | `#11161F` | |
| `surface` | `#1A212C` | |
| `surfaceAlt` | `#232C3A` | |
| `border` | `#2C3646` | |
| `borderStrong` | `#3B475A` | |
| `text` | `#EEF1F6` | 16.0:1 on `bg` |
| `textSecondary` | `#A7B0BE` | 7.4:1 on `surface`, 6.4:1 on `surfaceAlt` |
| `textTertiary` | `#7F8999` | 4.6:1 on `surface` |
| `navy` (hero fill) | `#22324D` | Hero card fill, lifted from bg |
| `primary` | `#86AEDB` | Text on it `#0F1A2A` 7.6:1; as text on `surface` 7.0:1 |
| `primaryTint` | `#1F2E42` | |
| `success` / `successText` | `#93C4A0` | 8.2:1 on `surface`; `#0F1A2A` on it 8.9:1 |
| `successTint` | `#1E3326` | text on it 6.8:1 |
| `warning` / `warningText` | `#E6B567` | 8.6:1 on `surface` |
| `warningTint` | `#3A2E17` | text on it 7.1:1 |
| `danger` / `dangerText` | `#EE958B` | 7.2:1 on `surface`; `#0F1A2A` on it 7.8:1 |
| `dangerTint` | `#3D2220` | text on it 6.4:1 |
| `neutralTint` | `#262D38` | `textSecondary` on it 6.3:1 |

### 1.3 Group accent colors (identity, not status)

Each group gets an accent for its icon tile so cards are scannable. They are only ever used as an icon background tint + icon color, never for status meaning.

| Accent | Light icon / tile | Dark icon / tile |
|---|---|---|
| Blue (e.g. Sunday Worship Team) | `#3A6894` / `#E5EDF5` | `#86AEDB` / `#1F2E42` |
| Plum (AV & Media) | `#7A5A8C` / `#EFE7F3` | `#C3A6D3` / `#2E2436` |
| Clay (Hospitality) | `#A0603E` / `#F6E8DF` | `#E3A88A` / `#382820` |
| Teal (Kids Ministry) | `#2F7C7A` / `#DFF0EE` | `#86CBC8` / `#1A3332` |

---

## 2. Status mapping (consistent everywhere)

Status always appears as **icon + label + color** (never color alone — color-blind safe).

| Status | Meaning | Pill bg / text | Icon (Lucide) | Notes |
|---|---|---|---|---|
| **Confirmed** | Assignee said yes | `successTint` / `successText` | `check-circle` | |
| **Pending** | Awaiting assignee confirmation | `warningTint` / `warningText` | `clock` | Drives "Needs your attention" |
| **Declined** | Assignee said no (transient, before coverage request goes out) | `dangerTint` / `dangerText` | `x-circle` | In practice collapses into Needs coverage immediately; shown in history/activity |
| **Needs coverage** | Open slot, nobody has volunteered | `dangerTint` / `dangerText` | `alert-circle` | Highest-priority admin signal |
| **Find a replacement** | Coverage Request got no taker by the alert time; Replacement Duty holder must arrange cover | `dangerTint` / `dangerText` | `alert-circle` | Primary action "Mark covered" (Group Member or Guest Cover). Informational for Admins when duty is on the Assigned Member |
| **Covered** | Someone took a Coverage Request | `primaryTint` / `primary` | `repeat` (swap) | Shows "Covered by Name" or "Covered by Name (guest)" |
| **Skip Date** | Event intentionally needs no one | `neutralTint` / `textSecondary` | `calendar-x` | Card gets a dashed `borderStrong` outline and reduced emphasis |
| *Scheduled* | Future, confirmation not asked for yet / Responsibility doesn't need confirmation | `neutralTint` / `textSecondary` | `calendar` | Keeps far-future items calm. Any Assignment whose date changes is reset to **Pending** regardless of distance |

**Make-up Turn** (Pay It Back) is not a status: it shows as a small `primaryTint` tag on the Assignment plus a `handshake`-icon info box ("You owe Ben a Make-up Turn: you'll take Ben's Jan 4 Sound turn").

---

## 3. Typography

**Family: Nunito Sans** (Google Fonts; `@expo-google-fonts/nunito-sans` for React Native).
Why: its softened terminals read friendly and warm without being cartoonish (unlike rounded Nunito), it has a large x-height and open apertures that stay legible at small sizes and for older volunteers, and a full weight range (400–800) gives strong hierarchy from one family. Tabular figures are available for dates/counts.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display` | 30 / 36 | 800 | Hero date ("Sun, Nov 22") |
| `title1` | 28 / 34 | 800 | Screen large titles ("Home", "Schedule") |
| `title2` | 22 / 28 | 750 | Sheet titles, group header |
| `title3` | 18 / 24 | 700 | Section headers, card titles |
| `body` | 16 / 24 | 400–600 | Default text (never smaller for primary content) |
| `callout` | 15 / 22 | 600 | Buttons, list row titles |
| `subhead` | 14 / 20 | 400–600 | Secondary lines, meta |
| `caption` | 13 / 18 | 600 | Pills, timestamps |
| `overline` | 12 / 16, +0.06em tracking, uppercase | 700 | Small section eyebrows ("NEXT UP") |

Minimum text size is 12px (overline only). Support Dynamic Type / font scaling in RN (`allowFontScaling` on).

---

## 4. Spacing

4-pt base. Tokens: `xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 40`.

- Screen side gutter: **16** (phones), 24 on tablet.
- Card inner padding: **16** (compact cards), **20** (hero).
- Gap between cards in a list: **12**. Between sections: **28–32**.
- Section header to content: **12**.

## 5. Radii

`sm 8` (chips inner, small tiles) · `md 12` (inputs, list tiles, buttons) · `lg 16` (cards) · `xl 24` (hero card, bottom sheets top corners) · `pill 999` (status pills, filter chips).

## 6. Elevation / shadows

Warm, low, diffuse. Navy-tinted rather than black so they don't look dirty on off-white.

| Token | CSS | RN approximation |
|---|---|---|
| `shadow1` (cards) | `0 1px 2px rgba(31,45,69,.06), 0 2px 8px rgba(31,45,69,.05)` | `shadowOpacity .06, radius 6, offset {0,2}`, Android `elevation 1` |
| `shadow2` (hero, floating) | `0 4px 12px rgba(31,45,69,.08), 0 12px 32px rgba(31,45,69,.08)` | `shadowOpacity .10, radius 16, offset {0,8}`, `elevation 4` |
| `shadow3` (sheets) | `0 -8px 32px rgba(31,45,69,.16)` | `elevation 12` |

Dark mode: shadows are replaced by a 1px `border` hairline plus a slightly lighter surface (shadows are invisible on dark).

## 7. Buttons and tap targets

All interactive elements have a **minimum 48×48 hit area** (visual can be smaller if padding/hitSlop extends it).

| Size | Height | Padding-x | Text | Use |
|---|---|---|---|---|
| `lg` | 56 | 20 | callout 16/700 | Hero Confirm / Can't make it, sheet primary actions |
| `md` | 48 | 16 | callout 15/700 | Default buttons, "I can cover" |
| `sm` | 40 visual (48 hit) | 14 | subhead 14/700 | Inline row actions |
| Chip | 36 visual (48 hit) | 14 | 14/600 | Filters, reason chips |

Variants: **Primary** (filled `primary`), **Positive** (filled `success`, used for Confirm), **Secondary** (`surface` + `borderStrong` outline, `text` label), **Quiet** (text-only `primary`), **Destructive** (filled `danger`; only for final destructive steps — "Can't make it" on the hero is *Secondary*, not red, so declining doesn't feel like failure).

Pressed state: scale 0.98 + 8% darker. Disabled: 40% opacity.

## 8. Icons

- **Lucide** line icons (`lucide-react-native` in the app; hand-inlined SVG in the prototype). 24px grid, **1.75 stroke**, round caps/joins.
- Sizes: 20 (inline with text), 24 (tab bar, row leading), 28 inside 44–48px tinted tiles.
- Tab bar: Home `house`, Groups `users`, Schedule `calendar`, Activity `activity`, Profile `circle-user`.
- Status icons are fixed (see §2). Group icons: `music` worship, `monitor` AV, `coffee` hospitality, `smile` kids (owner-selectable later).
- No emoji in UI chrome.

## 9. Components (summary)

- **Hero assignment card**: navy fill, white text, `xl` radius, `shadow2`, two `lg` buttons side by side.
- **Attention item**: surface card with a 4px left accent bar in the status color, icon tile, 1–2 lines, one inline action.
- **Group card**: 44px tinted icon tile, name, next date + primary responsibility lead, status pill, issue count badge.
- **Status pill**: 24px tall, `pill` radius, icon 14 + caption label.
- **Segmented control**: `surfaceAlt` track, `surface` selected thumb with `shadow1`.
- **Bottom sheet**: `xl` top radius, grab handle, dim scrim `rgba(17,22,31,.45)`, safe-area padding.
- **Tab bar**: `surface`, top hairline, 64px + safe area, active = navy (dark: `text`) with filled indicator dot; inactive = `textTertiary`.
