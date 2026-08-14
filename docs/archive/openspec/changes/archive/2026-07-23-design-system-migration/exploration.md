# Exploration: Design System v1 migration (dark → light admin theme)

> Summary of prior exploration (Engram `sdd/design-system-migration/explore`, obs #79).
> Retained here so the change folder is self-contained.

## Source-of-truth palette (`01-cata-club-design-system.pdf`, non-negotiable)

Five base colors, each with a light→dark ramp:
- Rojo intenso `#D92128` (dominant/brand/CTA)
- Amarillo `#FFD600` (promo/highlight, ALWAYS black text); amber variant `#F4B41A`
- Negro `#111111` (contrast/text/chrome)
- Fucsia `#E5397D` (accent, hover/micro-interactions only — never a block color)
- Blanco/gris `#F9FAFB` (background)

Reference tokens (p.10): `bg #F9FAFB`, `surface #FFFFFF`, `text #1F2937`,
`border #E5E7EB`, `state-ok #15803D` — plus the vibrant brand-red/yellow/amber/
fuchsia set above.

Typography: Graduate (display/headings), Barlow (landing body), Inter (admin UI,
already loaded in `layout.tsx`).

Accessibility (p.9): yellow always black text; red on white = good contrast;
black on white for reading text; fuchsia with white text is borderline —
reserve for icons/hover, never small text; never red-on-yellow or
yellow-on-red; status must be distinguishable by text/icon, not color alone.

## Critical contradiction (resolved by user — Track A / Track B split)

`02-migracion-panel-pitch.pdf` incorrectly claims the brand palette
(`#D92128`/`#FFD600`/`#111111`/`#E5397D`) already lives in `tailwind.config.ts`.
Verified false: the current `cata-*` namespace has `red: #8B1A1A` (old muted
red), no yellow, no fuchsia, no `#D92128` anywhere in `src/`. The vibrant
palette does not exist in code — it would need to be newly introduced, not
unlocked.

**Resolution (user decision, confirmed before this proposal):** split into two
tracked changes.
- **Track A (this change)** — light-surface migration only, literal execution
  of `03-tareas-implementacion.md` phases 0-6. Keeps the existing `#8B1A1A`
  primary red as-is.
- **Track B (future, separate SDD change)** — activates the vibrant palette
  (`#D92128` red, `#FFD600` yellow, `#E5397D` fuchsia) called for by PDF 01.

## Missing source document

`design/admin-design-system-audit.md` (referenced by PDF 02 as the per-view
detail source) does not exist anywhere on disk. Confirmed via Glob. Treated as
unavailable — proposal/design/tasks rely on the two PDFs plus live file reads
instead. Known constraint, not a blocker.

## Bug verification against live repo (branch `feat/refactor-and-responsive`)

| Bug | Status | Location |
|---|---|---|
| B1 — login demo role chips use off-brand colors | Verified, in scope | `src/app/login/page.tsx:23-27` |
| B2 — duplicated error banner markup | Verified, in scope | `src/app/login/page.tsx:221`, `src/app/register/page.tsx:127` |
| B3 — group level badges not using brand tokens | Verified, in scope | `src/app/groups/groups-page-utils.ts:59-63` |
| B4 — status badges use generic rgba, not `state-ok` | Verified, in scope | `src/app/globals.css:100-129` |
| B5 — fuchsia nav hover contrast | **Dropped** — not reproducible. No `landing.css` file exists; zero fuchsia usage anywhere in `src/`. Would only become relevant if Track B introduces fuchsia hover states. | n/a |

## Inventory (verified exact against live files, 15 Jul 2026)

13 views + 1 legacy stub: login 301, register 490, forgot-password 10 (stub),
dashboard 242, members 468, groups 625, payments 754, attendance 369,
trainer 393, trainer/attendance 624, student 964, student/enroll 1034,
products 11 (redirect only, no work).

11 of 13 views use the `cata-navy`/`cata-dark-surface`/`cata-dark-elevated`
hero-band pattern — broader than Fase 2 alone implies; Fase 2-5 all touch this
shared pattern.

## Other repo findings

- No React `Button`/`Card`/`Badge`/`Input` components exist — everything is
  Tailwind utility classes + shared `globals.css` classes. Confirms the task
  doc's "Opcional / no bloqueante" section is genuinely optional/future work.
- `tailwind.config.ts` has `darkMode: "class"` configured but unused — no
  toggle exists today; this is a one-way literal palette swap, not adding a
  dark/light switch.
- Recent commits on this branch (`e739503`, `bf20d44`) shipped dark-themed
  institutional hero banners — this change will immediately re-theme those
  same surfaces to light. Flagged as a merge-friction / rework risk.

## Approaches considered

1. **Literal task-doc execution (chosen for Track A)** — smallest blast
   radius, matches the reviewed task breakdown, defers the brand-hue question.
2. **Full palette activation in one change** — rejected as too large / risks
   the 400-line PR budget and re-litigates already-shipped hero/header work.
3. **Split into two tracked changes (chosen overall)** — Track A now
   (this change), Track B later for brand-hue activation.
