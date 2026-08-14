# Exploration: Admin Panel Usability Heuristics Audit (Track C)

> Parallel to `vibrant-palette-activation` (Track B). Must not touch
> `tailwind.config.ts`; uses only existing `cata-*` semantic classNames.

## Grounding

Read in full: `diseño_software_unidad3_tema2 (IU).pptx.pdf` (26 pages, UNL
Diseño de Software, Unidad 3). Frameworks applied below:
- **Nielsen's 10 heuristics**: 1 Visibilidad del estado del sistema, 2
  Coincidencia sistema–mundo real, 3 Control y libertad del usuario, 4
  Consistencia y estándares, 5 Prevención de errores, 6 Reconocimiento en
  lugar de recuerdo, 7 Flexibilidad y eficiencia de uso, 8 Diseño estético y
  minimalista, 9 Ayuda a reconocer/diagnosticar/recuperarse de errores, 10
  Ayuda y documentación.
- **Shneiderman's 8 golden rules**: 1 Luchar por la consistencia, 2 Buscar la
  usabilidad universal, 3 Entregar feedback, 4 Diseñar diálogos de cierre, 5
  Prevenir errores, 6 Permitir fácil reversión de acciones, 7 Darle el
  control al usuario, 8 Reducir la memoria de corto plazo.
- **Sneed (2024) 8 inclusion heuristics**: benefits, costs,
  gather-as-much-info, familiar-features, undo/redo, explicit-path,
  try-different-approaches, mindful-tinkering.

## Current state

Track A (merged) gives 9 dashboard-style views (`dashboard`, `members`,
`groups`, `payments`, `attendance`, `trainer`, `trainer/attendance`,
`student`, `student/enroll`) one consistent light hero-band + card pattern
(`rounded-3xl border border-cata-border bg-cata-surface ... px-6 py-10`,
`h1.text-3xl.font-extrabold`), grep-confirmed. 3 auth views (`login`,
`register`, `forgot-password`) use a separate centered-card pattern. Button
system is 3-tier: `.btn-primary` (solid `#8B1A1A`), `.btn-secondary`
(outlined), `.btn-ghost` (text-only), all in `globals.css`.

## Findings (each tagged with the specific heuristic it relates to)

### 1. Buttons — weight hierarchy exists, semantic color does not

- `.btn-primary`/`.btn-secondary`/`.btn-ghost` (`globals.css:59-83`) form a
  real weight hierarchy. **Satisfies** Shneiderman #1.
- **Violation** — `payments/page.tsx:650-673`: "Aprobar Pago" (positive) uses
  the same solid brand-red `.btn-primary` as any other primary action.
  `cata-state-ok` (green) exists as a token, used only on badges, never on a
  button. Approve looks identical to how a destructive action would look.
  **Violates** Nielsen #2 (red conventionally signals stop/danger, not
  approve) and Shneiderman #1 (color should map to situation, not just
  brand).
- **Violation** — asymmetric friction: `handleApprove` fires immediately, no
  confirmation, no summary. `handleRejectClick`/`handleRejectSubmit` require
  a typed reason + a second confirm click. The more reversible-feeling action
  has more friction than the less reversible one. **Violates** Shneiderman #4
  (no closure/summary step on approve) and Nielsen #3 (no undo after
  approve).
- No `.btn-danger`/destructive variant exists anywhere. Destructive-adjacent
  actions fall back to bare unstyled icon buttons. **Violates** Nielsen #4.

### 2. Dashboard — competing focal points, no urgency escalation

- `dashboard/page.tsx:113-181`: the 4 stat cards and 4 quick-action cards are
  visually identical containers (`.card-hover`, same icon treatment). Only a
  trailing arrow + `<Link>` wrapper distinguishes "look at this" from "click
  this." **Violates** Nielsen #8 (two different content types compete for
  the same visual slot) and weakens Nielsen #6.
- 2 of 4 stats are flagged "alert" (3 pendientes de validar, 2 pagos
  pendientes) but only a small amber corner badge differs — same card size,
  same icon. This is the clearest concrete instance of the user's own
  complaint ("falta jerarquía... dashboard"). **Violates** Nielsen #1
  (system state requiring action isn't visually prioritized).
- Positive: "Módulos del Sistema" card explains what each module does —
  **satisfies** Sneed inclusion heuristic 1.

### 3. Destructive/irreversible actions — inconsistent guardrails

- `groups/page.tsx:463-477`: `handleClearAssignment` (remove a student from
  a group) fires directly on click of a faint (`text-cata-text/45`) icon —
  no confirmation, no undo, no feedback. Contrasts directly with payments'
  reject flow (typed reason + explicit confirm). **Violates** Nielsen #3, #5,
  Shneiderman #5, #6.
- No reusable confirmation-dialog pattern exists anywhere in `src/app` —
  each screen that needs one invents its own. **Violates** Nielsen #4 as a
  standing risk for future work too.

### 4. Status feedback — present but inconsistently applied

- `login/page.tsx` is a strong example: "Iniciando sesión..." state,
  disabled inputs, inline `.alert-error` with `role="alert"`, visible
  forgot-password path, inline demo-credential docs. **Satisfies** Nielsen
  #1, #9, #10, Shneiderman #3.
- But the same page's demo-login quick buttons redirect instantly with zero
  loading state, while the manual form path shows "Iniciando sesión..." for
  the *same underlying action*. **Violates** Shneiderman #1 (inconsistent
  feedback for equivalent actions).
- Payments approve/reject share an `actionLoading` → "Procesando..." state;
  no equivalent loading indicator found for members/groups list mutations.

### 5. Consistency across the 13 views

- Hero-band + h1 pattern: consistent across the 9 dashboard-style views.
- **Drift** — `student/enroll/page.tsx:975-986` reimplements its own
  validation-error box instead of reusing the shared `.alert-error` class
  that login/register already use. Same purpose, different tokens.
  **Violates** Nielsen #4, and directly contradicts Track A's own stated
  intent (`design-system-migration/design.md:24`) that the `.alert-error`
  convergence was never extended to the enroll wizard.
- `forgot-password/page.tsx` (10 lines) is a bare stub next to its otherwise
  polished login/register siblings — no card, no button, no way back.
  **Violates** Nielsen #4 (fidelity consistency) and #10 (no guidance on what
  to do instead).
- Section-header hierarchy is inconsistent: `dashboard` uses h2 + h3 levels;
  `members/page.tsx` has **no h2 at all**, only a single h3. **Violates**
  Nielsen #4 at the intra-page structural level.

### 6. Typography/spacing hierarchy

- Scale where present is defensible: h1 (`text-3xl`/`text-4xl`
  `font-extrabold`) → h2 (`text-lg font-bold`) → h3 (`text-sm font-bold`) →
  body.
- **Drift** — `student/enroll/page.tsx:961` step header uses `text-lg
  font-semibold` (same nominal rank as dashboard's h2, different weight).
- No intermediate size exists between `text-lg` (h2) and `text-3xl` (h1);
  dense pages with a skipped h2 rank (e.g. `members`) flatten the perceived
  hierarchy — matches the user's own description directly.

### 7. Positive counter-examples worth preserving

- `student/enroll/page.tsx`: explicit step order + numeric progress bar,
  mandatory summary-review gate before submit, demo quick-fill helper.
  **Satisfies** Shneiderman #4, Nielsen #3, Sneed heuristics 6 and 7.
- Payments' reject flow (required reason, can't submit empty) **satisfies**
  Nielsen #5/#9 and Shneiderman #5.

## Affected areas (for the proposal — not solutioned here)

- `src/app/globals.css` — button system: add semantic color mapping, danger
  variant
- `src/app/dashboard/page.tsx` — stat vs. quick-action visual differentiation
- `src/app/payments/page.tsx` — approve/reject friction symmetry
- `src/app/groups/page.tsx` — confirm-before-destroy on remove-from-group
- `src/app/student/enroll/page.tsx` — reuse `.alert-error` instead of a
  bespoke box
- `src/app/forgot-password/page.tsx` — fidelity gap vs. sibling auth screens
- `src/app/members/page.tsx` and others — missing h2 rank

All reachable without touching `tailwind.config.ts`, using only existing
`cata-*` tokens (`cata-state-ok`, `cata-red`, `cata-navy`, `cata-border`,
etc. already exist post-Track-A) — consistent with the Track B/C isolation
constraint.

## Recommendation

Findings are concrete, file-line-grounded, each cites a specific named
heuristic. Ready for `sdd-propose` to scope fixes: semantic button
color-coding, a shared confirmation-dialog pattern, dashboard card
differentiation + urgency escalation, `.alert-error` reuse in enroll,
forgot-password fidelity, consistent section-header ranks.

## Risks

- Read-only static analysis of JSX/CSS — no live/rendered visual QA
  (contrast ratios, actual click-target sizing) performed; recommend a
  manual pass during `sdd-verify` for visual claims.
- Any new semantic button color (e.g. `cata-state-ok` on an approve button)
  must confirm that token still exists post-Track-B and is not renamed.
