# Design system notes

Reference for staying visually consistent with the rest of this app. Written from what's actually
in the codebase today (`src/styles.css` + the patterns repeated across `src/components/**`), not
an aspirational spec — if code and this doc ever disagree, trust the code and update this file.

The base color/typography tokens (`src/styles.css`, fonts in `src/routes/__root.tsx`) were re-themed
onto Zaimler's real design system, sourced from a Figma-exported spec (`design.md`) — zinc neutrals
+ teal brand accent, Geist/Inter/SF Mono fonts, replacing the prototype's original oklch blue +
IBM Plex system. The ontology-specific review-status and mapping colors (Suggested/Confirmed/
Warning/Error, Mapped Column/Property) are untouched, since `design.md` doesn't define them. If a
"real" Figma-sourced spec update ever supersedes this, prefer it over this doc.

## Semantic tokens (`src/styles.css`)

Real Tailwind v4 `@theme` tokens, defined in oklch, with light/dark variants. Prefer these over a
raw hex whenever the thing you're styling is one of:

- `bg-background` / `text-foreground` / `bg-card` / `bg-popover` — base surfaces, now bound to the
  Zaimler **zinc** neutral scale (zinc-50 background, zinc-950 foreground) instead of the old
  blue-tinted neutrals
- `bg-primary` / `text-primary` — bound to **teal-900** (`#012C34`) in light mode / **teal-400**
  (`#62E7E0`) in dark mode, per the Zaimler design system (`design.md`)
- `bg-accent` — neutral gray (`#e0e0e0`, light mode only) — hover surfaces; deliberately NOT a
  brand-teal tint (it was teal-100/`#D2FFFA` "ICE" before, moved to neutral so hover doesn't read
  as an active/brand state)
- `--ring` (focus rings) — **teal-500** (`#00DED8`, "TURQUOISE") — note this step is explicitly
  fill/accent-only per the Zaimler palette (1.69:1 on white), never used as text
- `bg-muted` / `text-muted-foreground` (zinc-100 / zinc-500) / `bg-destructive` (Tailwind red-600)
- `bg-canvas` + `canvas-grid` utility — the dotted canvas background
- `bg-node` / `border-node-border` — the white node/card surface + its hairline border
- `bg-ok` / `text-ok`, `bg-review` / `text-review`, `bg-data` / `text-data` (+ their `-soft`
  variants) — success / AI-review / data-source accents
- `shadow-[var(--shadow-node)]` (resting card) and `shadow-[var(--shadow-node-lift))` (popover /
  lifted card) — the two standard elevation shadows, used instead of Tailwind's default `shadow-*`
  scale everywhere a card or floating panel needs one
- `rounded-sm` / `-md` / `-lg` / `-xl` / `-2xl` / `-3xl` / `-4xl` — all derived from one `--radius`
  (`0.625rem`), so bumping that one variable reshapes every rounded corner in the app consistently

## The Figma accent palette (used ad hoc, alongside the tokens)

A lot of UI in this app was built straight from Figma exports, so it leans on a small recurring
set of raw hex values rather than the semantic tokens above for chrome the token system doesn't
cover. These aren't registered as tokens yet, but they're consistent enough across the app to
treat as fixed — reuse the existing value rather than eyeballing a new one:

| Hex | Used for |
| --- | --- |
| `#00ded8` (teal-500 "TURQUOISE") | The "AI / active review" accent — Confidence score, Select-in-range, Filter's active state, focus rings, drop-target highlight. Migrated from the old ad-hoc cyan/blue trio (`#00b8db` / `#61B2FF` / `#60a5fa` / `#38bdf8`) to the one Zaimler brand teal when `design.md` was applied — if you see any of those old hexes reappear in a diff, they should be `#00ded8` instead |
| `#1c1c18` | Primary heading/label text and the near-black filled buttons (Generate Suggestions, Back to Ontology view) — conceptually now the app's zinc-950/zinc-900 neutral, left as its original hex since a literal find/replace onto the new token wasn't part of this pass |
| `#707070` / `#909090` / `#3C3C3C` / `#70757C` | Secondary/tertiary text — labels, counts, muted metadata, roughly light→dark in that order — same status as `#1c1c18` above, not yet migrated to the zinc scale |
| `#f15b15` / `#9c461e` / `#ffe6db` | Error / Decline — border, text, and soft background respectively |
| `#553eb7` / `#e1daff` / `#7c5eff` | "Suggested" review status (icon color / badge bg / border) |
| `#0298b2` / `#c7eef5` / `#007287` | "Confirmed" review status |
| `#e6c200` / `#faebb0` / `#967700` | "Warning" review status |
| `#318F5A` / `#EAF7ED` | Mapped Column — text / soft green background |
| `#553EB7` / `#F5F3FF` | Mapped Property — text / soft purple background (same purple family as Suggested, different role) |

**Status badges now follow Figma "Item Status(Temporal)"** (frames `492:57788` / `328:4527`):
Suggested is an ICE `#d2fffa` disc with a `#0891b2` sparkle (ring/dot `#0891b2`), Confirmed a
`#bbf7d0` disc with a `#16a34a` check (dot `#16a34a`) — in `StatusBadge` and `ItemStatusIcon`. The
purple/cyan trios in the table above now only describe the older Overview edge/border accents.
Overview's Data tables panel is 240px wide with 14px/12px rows and 16px `MappingStatusBadge`s.

These review-status and mapping colors (Suggested/Confirmed/Warning/Error, Mapped Column/Property)
are ontology-domain semantics that `design.md` doesn't define — they're intentionally untouched by
the Zaimler re-theme and aren't expected to move to teal/zinc.

If you introduce a genuinely new color, prefer adding it as a semantic token in `styles.css` over
another one-off hex, but matching an *existing* raw value exactly is more important than migrating
it — don't do a token-migration refactor as a side effect of an unrelated change.

## Typography

No formal type scale file — sizes are set inline per element, but they cluster tightly. In
descending order, the recurring sizes are:

`20px` (page title, e.g. "Ontology") → `16px` → `14px` (card titles, panel headers) → `13px` (the
most common body/label size — buttons, row primary text) → `12px` (secondary row text) → `11.5px`
/ `11px` (tooltips, helper text) → `10.5px` / `10px` (metadata, counts, chips).

Font: **Geist** (`--font-sans`, loaded from Google Fonts in `src/routes/__root.tsx`) for everything
except monospace type/column labels, which use `font-mono` (`ui-monospace, "SF Mono", "Geist Mono"`
— renders as native SF Mono on macOS/Safari, Geist Mono elsewhere). A `--font-display` token
(Inter, standing in for Zaimler's "Inter Display") also exists for large display headings per
`design.md`, but nothing in this app currently opts into it — the whole UI is small/dense enough
that it's stayed on `--font-sans` throughout. Reach for `font-display` if a genuinely large,
headline-sized heading gets added.
Tight tracking is common on small labels: `tracking-[-0.076px]` / `tracking-[-0.08px]`.

## Corner radius in practice

- `rounded-full` — pills, badges, circular icon buttons, avatar-style status dots
- `rounded-[10px]` — the single most common card/button/input radius (buttons, chips, the Filter
  and Search popovers' own trigger buttons)
- `rounded-[16px]` — Entity/Table cards on the canvas
- `rounded-2xl` (`1rem`-ish via the token) — floating popovers (Filter, Search, History)
- `rounded-md` / `rounded-lg` — smaller inline controls (icon buttons, dropdown items)

## Canonical components — check these before building a new indicator

- **`StatusBadge`** (`src/components/ontology/StatusBadge.tsx`) — the colored circle + glyph for
  an Entity/Property/Relation's `ReviewStatus` (suggested/confirmed/warning/error). Also exports
  `statusBorderColor(status)` and `reviewStatusLabel(status)` for anywhere that needs just the
  color or just the label without the full badge.
- **`ConfidenceChip`** (`src/components/ontology/ConfidenceChip.tsx`) — the small "N%" pill with a
  hover tooltip explaining the AI's reasoning (`aiReasoning(confidence)`, bucketed at 85%/60%
  thresholds). Renders "—" for `undefined` confidence rather than a fake number — always pass
  `confidence: number | undefined` through, never coerce a missing value to `0`.
- **`MappingStatusBadge`** (`src/components/overview/MappingStatusBadge.tsx`) — a *different*
  concept from `StatusBadge`: whether a Table/Column is mapped (a completeness fact), not whether
  it's been reviewed. Don't conflate the two even though Figma names both similarly.
- **`nav-icons.tsx`** (`src/components/nav/`) — the small icon set used in the Header's Stat pills
  (Entities/Properties/Relations/Tables/Columns).

## Interaction conventions

- **Popovers** (Filter, Search, History): a trigger `<button>` + `useState` open flag + a
  `window.addEventListener("pointerdown", ...)` outside-click handler that closes on any pointerdown
  outside a `ref`'d container — see `FilterPopover`/`GlobalSearchPalette`/`HistoryPanel` in
  `src/components/nav/`. Not a portal/dialog library; a plain `absolute` positioned div.
  Header-level popovers stack at `z-30` (Header itself sets this) so they always paint above
  canvas content regardless of the canvas's own internal z-indices.
  Elevation is `shadow-[var(--shadow-node-lift)]`, border `border-[rgba(28,28,24,0.08)]`, on a
  `bg-white` panel — this exact trio is the exact look of a floating panel here.
- **Hover-reveal actions** (delete buttons, connection handles): `opacity-0` by default,
  `group-hover/<name>:opacity-100` on reveal, using a named group (`group/relbadge`,
  `group/entitycard`, `group/prop`, `group/col`) rather than a bare `group` — several nested
  hoverable regions on the same canvas node mean the plain `group` class would collide.
  Delete controls specifically also add `transition-opacity`.
- **Draggable canvas elements**: `onPointerDown={(e) => e.stopPropagation()}` on anything that
  needs its own click, since the canvas's own background pointerdown handler is what drives
  panning — omitting this makes a click "leak" into a pan/deselect instead of hitting the element.
- **Confidence-range / Filter dimming**: out-of-scope items get `opacity-40`, never removed from a
  list or the canvas — see `isReviewItemInScope`/`isTableInScope`/`isColumnInScope` in
  `src/lib/mock-data.ts`. If you add a new object type to the review system, dim it the same way;
  don't hide it.
