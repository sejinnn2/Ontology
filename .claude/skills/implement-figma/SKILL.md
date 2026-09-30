---
name: implement-figma
description: "Use whenever a Figma design (a figma.com link, or 'implement/build/port this Figma frame/design/screen') is being turned into code in THIS repo (Zaimler Ontology). Layers project-specific rules on top of the generic figma-design-to-code workflow: Figma is the visual source of truth, existing components/tokens must be reused instead of re-invented, existing app behavior must be preserved when reskinning a screen that already has a working prototype, and the implementation must be visually verified against the Figma screenshot before being called done. Do not use for the reverse direction (code -> Figma) or for non-visual/logic-only work."
disable-model-invocation: false
---

# Implement Figma designs in this repo

This skill governs **every** Figma → code task in this project. It does not replace the
mechanical workflow in `figma-design-to-code` (node-id/file-key extraction, `get_design_context`
call shape, asset handling) — load and follow that skill's steps too. This skill adds the rules
specific to *this* codebase: what "done" means here, and the guardrails that keep a Figma import
from drifting away from the app's real design system or silently breaking working features.

Read `CLAUDE.md` at the repo root before starting — it is the canonical, code-verified design
system reference for this project. Everything below assumes it's been read.

## Prime directive: Figma is the visual source of truth, not a suggestion

- Build exactly what the Figma node shows: layout, spacing, type scale, colors, copy, icon choice,
  states. Do not "improve," simplify, restyle, or fill gaps with your own taste.
- Never invent values that aren't in the design and aren't already an existing token/hex in this
  repo (see reuse rules below). If something in the frame is ambiguous or missing (a state not
  shown, a truncated string, an icon you can't identify), say so and ask rather than guessing.
- If you must deviate from the literal Figma output for a technical reason (e.g. the raw export
  can't reuse an existing component as-is), say what you changed and why — don't do it silently.

## Reuse mandate — check these before writing anything new

This app already has a real, fairly mature design system. `get_design_context`'s raw React+Tailwind
output is a REFERENCE ONLY (per `figma-design-to-code`) — before turning it into code, map it onto
what already exists here:

1. **Semantic tokens** — `src/styles.css` (`@theme inline` + `:root`/`.dark`, oklch). Use
   `bg-background`, `text-foreground`, `bg-card`, `bg-primary`, `bg-accent`, `bg-muted` /
   `text-muted-foreground`, `bg-destructive`, `bg-canvas`, `bg-node` / `border-node-border`,
   `bg-ok`/`bg-review`/`bg-data` (+ `-soft`), `shadow-[var(--shadow-node)]` /
   `shadow-[var(--shadow-node-lift)]`, and the `rounded-*` scale — see the "Semantic tokens" table
   in `CLAUDE.md` for exactly which raw Figma output each one should replace.
2. **The Figma accent hex table** in `CLAUDE.md` ("The Figma accent palette") — a fixed set of raw
   hexes (`#00ded8`, `#1c1c18`, the review-status trios for Suggested/Confirmed/Warning/Error, the
   Mapped Column/Property greens/purples, etc.) used ad hoc alongside the tokens. If a color in the
   new Figma node is conceptually one of these (an AI/active-review accent, a status color, muted
   secondary text), reuse the **existing exact hex**, don't introduce a new one.
3. **Canonical domain components** — check before building a new indicator of any kind:
   - `StatusBadge` (`src/components/ontology/StatusBadge.tsx`) — review-status circle+glyph
     (suggested/confirmed/warning/error). Also exports `statusBorderColor()` / `reviewStatusLabel()`.
   - `ConfidenceChip` (`src/components/ontology/ConfidenceChip.tsx`) — the "N%" pill with hover
     reasoning tooltip. Always pass `confidence: number | undefined`, never coerce a missing value
     to `0`.
   - `MappingStatusBadge` (`src/components/overview/MappingStatusBadge.tsx`) — mapping
     *completeness*, not review status. Don't conflate with `StatusBadge` even when a Figma layer
     name suggests they're the same thing.
   - `nav-icons.tsx` (`src/components/nav/`) — the Header stat-pill icon set.
4. **shadcn/Radix primitives** — `src/components/ui/*` (accordion, alert-dialog, avatar, badge,
   button, card, checkbox, collapsible, command, dialog, dropdown-menu, hover-card, input, label,
   popover, progress, radio-group, scroll-area, select, separator, sheet, slider, switch, table,
   tabs, textarea, toggle(-group), tooltip, etc.). If the Figma node is a dialog/dropdown/tooltip/
   popover/select/tabs/etc., start from the matching primitive here instead of hand-rolling markup,
   unless this app's own interaction convention (below) explicitly diverges from it.
5. **`cn()`** from `src/lib/utils.ts` for conditional classNames — not manual template strings.
6. **Typography / radius conventions** in `CLAUDE.md` — the recurring size cluster (20/16/14/13/
   12/11.5/11/10.5/10px), `font-sans` (American Grotesk, self-hosted — see `src/styles.css`
   `@font-face` blocks; `font-mono` for types/column labels), and the radius scale (`rounded-full`
   for pills/badges, `rounded-[10px]` for the common card/button/input radius, `rounded-[16px]` for
   canvas Entity/Table cards, `rounded-2xl` for floating popovers). Match the *nearest existing*
   convention rather than the literal px value Figma's export happens to emit, unless the design
   clearly intends a new one.
7. **Interaction conventions** in `CLAUDE.md` — reuse the existing patterns for popovers (trigger
   button + `useState` + outside-`pointerdown` close, not a portal), hover-reveal actions (named
   `group/<name>` + `opacity-0`/`group-hover/<name>:opacity-100`, never a bare `group`), draggable
   canvas elements (`onPointerDown={(e) => e.stopPropagation()}`), and confidence/filter dimming
   (`opacity-40`, never remove from the DOM/canvas — see `isReviewItemInScope` et al. in
   `src/lib/mock-data.ts`).

**When a value genuinely doesn't exist yet** (a new one-off hex, a new component shape), it's fine
to add it — but prefer registering a new color as a semantic token in `styles.css` over another
one-off hex, and don't let that turn into an unrelated token-migration refactor.

### When Figma's raw values conflict with what's already in the app

`get_design_context` output often carries generic/placeholder variable names from the Figma file
(e.g. `--zinc/50`, `--purple/300`, `--cyan/200`, `--sidebar/selected`) whose literal hex can differ
slightly from this app's already-established token or hex for the *same concept* (e.g. the
Suggested/Confirmed status colors, or the sidebar surface colors). Per `CLAUDE.md`: "if code and
this doc ever disagree, trust the code," and matching an existing raw value exactly is more
important than migrating it. So:

- If an existing component/token already renders that concept elsewhere in the app, reuse its
  existing exact value — do not quietly adopt the new Figma frame's slightly-different hex.
- If the discrepancy is more than a rounding difference (a different hue family, a different
  radius/spacing scale, a different font), STOP and flag it to the user before implementing —
  this may mean the Figma frame is a genuinely newer spec that should supersede the doc/tokens, and
  that's a call for the user to make, not one to resolve silently in either direction.

## Preserve existing behavior when reskinning a live screen

Several screens in this app (see `src/routes/index.tsx`, `src/components/detail/*`,
`src/components/overview/*`) are already full working prototypes with real state, handlers, and
interaction logic wired through `src/lib/app-state.ts` / `src/lib/ontology-context.tsx` /
`src/lib/mock-data.ts`. When a Figma frame is a restyle of a screen that already exists:

- Treat the task as a **visual** port, not a rewrite: keep the existing component's state,
  handlers, hooks, and data flow intact. Only change markup/classNames/structure needed to match
  the new design, unless the user has explicitly asked for a behavior change too.
- Read the existing component fully before touching it, and identify every interactive feature it
  currently supports (drag, hover-reveal, selection, popovers, undo/redo, filters, etc.) so none of
  them are silently dropped in the port.
- If the new Figma frame implies a genuine interaction/behavior change (not just visuals), call
  that out explicitly and confirm before implementing it — don't infer new product behavior from a
  static design.

## Visual verification — required after implementation, before calling it done

A Figma port is not finished when the code compiles. After implementing:

1. Get a reference screenshot of the target Figma node (`get_design_context`'s screenshot, or
   `get_screenshot` if you need it standalone/at a specific scale).
2. Launch the app and capture the actual rendered result of the same screen/state — use this
   project's `run` skill if available (it knows how to start and drive this app), otherwise
   `vite dev` + a browser/screenshot tool.
3. Compare the two side by side: layout and spacing, colors (against the tokens/hexes actually
   used, not just "looks close"), type sizes/weights, corner radii, icon choice, and any
   interactive states the design shows (hover, expanded, selected).
4. Fix any real mismatch before reporting the work as done. If something can't be verified visually
   (e.g. a hover/drag state that's hard to capture), say so explicitly rather than claiming full
   parity.
5. Report deviations you kept on purpose (e.g. reused an existing hex instead of Figma's literal
   export value) alongside the verification result, so the user can see what changed and why.

## Assets

Follow `figma-design-to-code`'s asset rules exactly: every icon/image comes from its exported
asset (never hand-authored `<svg>`), sized with an explicit square container plus a filled leaf
`<img>` (never `auto`), and downloaded-and-committed for anything going into the codebase since the
Figma asset URLs expire in ~7 days.
