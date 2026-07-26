---
target: app (dashboard, members, attendance, groups, trainer)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
timestamp: 2026-07-25T04-37-47Z
slug: frontend-src-app
---
Method: dual-agent (A: abb42841bef6aa8af design review · B: adb33d24c5bc3bc4c detector+browser)
Surface: App — dashboard, members, attendance, groups, ranking, payments, reports, profile, student, trainer/* + shared shell
Mode: Operate

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `members/page.tsx:897-904` — "Cancelar" and "Guardar cambios" share the handler `onToggleEditModal`; the primary button is a lie. `ProtectedRoute.tsx:57` renders "Cargando sesión…" as `text-white/65` on `#F9FAFB` |
| 2 | Match System / Real World | 2 | Three date formats, none of them the specified dd/mm/yyyy; Argentine voseo ("tenés", "Adjuntá", "Llevalo") in an Ecuadorian product; the trainer's own nav item is the English word "Dashboard" |
| 3 | User Control and Freedom | 2 | No edit path after "Confirmar Asistencia"; role toggles write to the backend on click with no confirm and no undo, while a reversible payment approval is gated behind a ConfirmDialog — risk gating inverted |
| 4 | Consistency and Standards | 1 | 16 enumerated deltas: 6 paginators in 3 treatments, 4 badge vocabularies, 4 error blocks, 3 date formats, 2 currency formats, 2 spinner glyphs |
| 5 | Error Prevention | 2 | `trainer/attendance/attendance-utils.ts:115` defaults every unrecorded student to `"absent"`; a trainer can tap through and file a whole session as a no-show |
| 6 | Recognition Rather Than Recall | 2 | `AppShell.tsx:307` — the page `<h1>` is `sr-only`. No authenticated screen displays its own name |
| 7 | Flexibility and Efficiency | 2 | Ctrl+K palette searches nav labels only; zero bulk operations; six prev/next paginators with no jump, no page size, no range readout; zero URL state |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained, one shadow scale, one radius family — but every list page front-loads 3-4 stat cards above the actual work |
| 9 | Error Recovery | 2 | `trainer/attendance/page.tsx:681-690` reports "N registro(s) no se pudieron guardar" without naming which students, then asks the trainer to retry for students it refuses to identify |
| 10 | Help and Documentation | 2 | `ContextualHelp` is well-built and used in exactly two places, collapsed, behind "Ver ayuda". Nothing anywhere explains what level 1 vs level 10 means |
| **Total** | | **20/40 (50%)** | **Acceptable — low band** |

## Design Specificity Verdict

**Generic admin template with three club-shaped patches sewn on.** The evidence is structural, not stylistic.

The same eight-line stat-card block is copy-pasted five times — `dashboard/page.tsx:161-193`, `attendance/page.tsx:191-238`, `payments/page.tsx:246-281`, `members/page.tsx:115-127`, `trainer/page.tsx:283-312` — always `h-10 w-10` tinted rounded square, lucide icon at `size={20} strokeWidth={1.5}`, uppercase tracking-wider label, `text-2xl font-bold` number. Every list page then drops the identical `card` → `overflow-x-auto` → `<table>` with a `bg-cata-bg` uppercase header, then the identical prev/next. Replace the Spanish strings with "Invoices / Customers / Tickets" and not one layout decision would object.

`dashboard/page.tsx` in its entirety is a table of contents for the sidebar beside it — `quickActions` (:39-64) duplicates four of the seven sidebar links. `NAV_ICON_MAP` (`Header.tsx:54-70`) assigns `Users` to both `/members` and `/groups`, and `Calendar` to both `/attendance` and `/trainer/attendance`: the icon language cannot distinguish the club's own sections from each other.

Genuinely club-specific and deserving credit: the four-state attendance vocabulary with a single shared token map; the "Registrando como: {trainer}" attribution line (`trainer/attendance/page.tsx:557-562`), which exists because a substitute trainer can take another's session — a real operational rule made visible; the guardian→dependent profile switcher (`student/page.tsx:501-527`); the voucher-upload → reject-with-reason loop.

But those live inside generic components, and **nothing about table tennis appears in the interface's form.** The single most club-specific rule in the product — levels 1-10 where 1 is the top — has zero visual expression: no scale, no ladder, no ordinal weight, just `describeRanking` returning a text label into a `card-hover` (`student/page.tsx:140-157`). The brand mark is a JPEG photograph used as a 32-40px `object-cover` square (`Header.tsx:279-287`), which at nav size renders as a colored blob. The chat FAB ships a `Volleyball` icon with a code comment apologising that lucide has no paddle (`ChatWidget.tsx:79-81`) — the interface documents its own inability to look like the sport it serves.

Brand lives in precise details on an Operate surface. There is exactly one such detail here and it is invisible: `parseDateStringLocal` anchoring date-only strings at noon UTC because America/Guayaquil is UTC-5 (`lib/format-utils.ts:16-30`). That is the level of care the visible layer never reaches.

**Deterministic scan (Assessment B):** 17 raw findings → 1 true positive + 1 dead-code cleanup. 14 `broken-image` hits are all `next/image` test doubles inside `__tests__` and never ship. `codex-grid-background` at `globals.css:176` flags `.bg-subtle-dot`, which `rg` proves is referenced exactly once — its own definition — so it renders nowhere; real as dead CSS, not as a visual defect. The substantive evidence in this run came from browser measurement, not the detector.

**Browser measurements (23 page-viewport combinations, 3 roles, all logins succeeded):** zero JavaScript exceptions, zero React warnings, zero hydration errors, zero failed static assets anywhere. Confirmed defects:

1. **Horizontal overflow on `/payments` at 390px** — `scrollWidth 450 > innerWidth 390`. Root cause measured: the status filter row at `payments/page.tsx:288` is `flex items-center gap-2` with computed `flex-wrap: nowrap`, container 335px, content 430px; the "Rechazados" chip ends at x=450. The table itself is correctly contained (763px inside a 333px scroll container) — the table is not the culprit.
2. **Offscreen mobile drawer keeps 11 focusable controls in the tab order** — the closed sidebar sits at `transform: matrix(1,0,0,1,-256,0)` with `visibility: visible`, `aria-hidden` null, `inert` false, and 11 focusable descendants. `AppShell.tsx:181-185` toggles only the transform.
3. **Four measured contrast failures** — `/ranking` "Sin asignar" `rgb(156,163,175)` on `rgb(243,244,246)` = **2.31:1** (needs 4.5), the most severe; `/trainer` "Registrar Asistencia" `rgb(229,57,125)` on `rgb(249,250,251)` = 3.85:1 (×2); `/trainer` "Sesiones de hoy en unos pasos" at 60% alpha = 3.85:1 (×2); `/dashboard` "Atención" `rgb(31,41,55)` on `rgb(217,33,40)` = 2.93:1 vs 3.0 required (marginal).
4. **Undersized targets in the trainer's core workflow** — all four per-student status buttons measure **30px tall** at 390px; 40 buttons measured in one rendered batch (10 students × 4 states, roster is 44). Elsewhere: `/groups` 27x27 icon buttons with no `aria-label` (accessible name comes only from `title`, the weakest source); `/members` row Editar 27x27; `/login` password reveal 16x16; app-shell Notificaciones 32x32, Colapsar menú 28x28.
5. **No mm/dd/yyyy anywhere from app code** — every date call is locale-pinned to `es-EC` (6 occurrences, zero unpinned `toLocaleDateString`). What is real is inconsistency inside one view: `/payments` renders PERÍODO as `2026-07-01 – 2026-08-12` (raw ISO) and SUBIDO as `23 de julio de 2026 · 07:11` in the same row; `/reports` renders "Fecha Nac." as `1990-01-01`.
6. `GET /api/members` → 403 as `ana@`: the role guard works and redirects, but the client fires the request before the guard resolves, producing a console error on an expected access-denial path.

No visual overlay was produced: the MCP browser runs in a separate filesystem namespace so screenshots could not be retrieved. All findings come from DOM/computed-style measurement.

## Overall Impression

The code is more careful than the interface. Someone wrote a timezone-correct date parser for Guayaquil, built a donut chart that reads correctly with a screen reader, a keyboard, a mouse and on paper, and documented why one dialog needs a manual focus trap and the other doesn't. And then shipped a save button that saves nothing and an attendance wizard that defaults 44 students to absent.

Biggest opportunity: **consistency, not visual expression.** On an Operate surface the 16 deltas in the consistency audit are the whole story — they are what makes this feel like four products stitched together.

## What's Working

1. **Attendance state has real cross-screen integrity — the one concept in the app that does.** `attendance-utils.ts:126-131` is a single token map, and `trainer/page.tsx:71-83` carries an explicit comment refusing to re-declare it ("reuses the SAME shared color tokens/labels so estado colors stay byte-identical to the admin view instead of a second drifting mapping"). "Tardanza" is the identical amber in the admin table, the trainer history, the wizard toggles and the student portal. Correct instinct, applied to exactly one domain — which is precisely why the other fifteen deltas are so visible.
2. **The donut chart is built to survive.** `AttendanceStatusChart.tsx` puts every value in a real `<table>` legend rather than behind hover (:93-127), gives each arc a `<title>` and a conditional `tabIndex`, and mirrors hover/focus bidirectionally between arc and row. Almost no dashboard chart does all four.
3. **`parseDateStringLocal` proves someone thought about Ecuador specifically.** `format-utils.ts:16-30` anchors date-only strings at noon UTC with a comment naming America/Guayaquil and UTC-5 — because otherwise a payment dated today displays as yesterday. A defect nobody would notice until an admin argued with a parent about a payment date.
4. **Both dialog implementations are correct and the divergence is documented.** `ConfirmDialog.tsx:52-83` implements a real focus cycle with restoration; `members/page.tsx:514-549` uses native `<dialog>` + `showModal()` and explains in a comment why it doesn't need the manual trap.

## Priority Issues

**[P0] The attendance wizard defaults an entire roster to absent and lets it be submitted untouched.** `attendance-utils.ts:115` sets `attendance: existing ?? "absent"`; `page.tsx:782` gates "Siguiente" only on `students.length === 0`. A trainer can tap Continuar → Siguiente → Confirmar and file every student as a no-show. This is the club's highest-frequency write, performed one-handed on a phone by a distracted user, and it is destructive — absences drive membership disputes and level decisions. The confirmation screen renders "0 Presentes" at the same visual weight as "0 Justificados", so the summary doesn't catch it. Compounded by 30px targets and a paginated roster whose off-page students submit anyway.
Fix: introduce an `unmarked` state distinct from `"absent"`; render unmarked rows with a neutral outline and a visible "Sin marcar: N" counter; disable `handleNext` while `unmarkedCount > 0` with the count as the disabled reason; add "Marcar todos presentes" above the roster (the common case is nearly-full attendance); raise the four state buttons to `min-h-[44px]` in a `grid grid-cols-4` full-width row on mobile; wrap them in `role="radiogroup"` with `aria-labelledby` on the student name; move Siguiente/Confirmar into a `sticky bottom-0` bar. Suggested command: `/impeccable harden`.

**[P0] "Guardar cambios" in the members edit modal saves nothing.** `members/page.tsx:897-904` — both footer buttons are `onClick={onToggleEditModal}`. The primary, red, right-most button labelled "Guardar cambios" only closes the dialog. Everything above already auto-saved per-action; the identity fields have their own separate "Guardar datos" at :787-799. An admin who edits Nombres/Apellidos/Teléfono and clicks the obvious primary button loses the edit and gets a success-shaped interaction confirming it — the system reports success for work it discarded.
Fix: delete both footer buttons, replace with a single `btn-secondary` "Cerrar"; move the auto-save contract into the header as "Los cambios se guardan al momento"; relabel :798 to "Guardar nombre y teléfono"; lift `onMembershipCreated` to `MembersPage` and call `loadMembers()` so :301's "Recarga para verla." can go. Suggested command: `/impeccable harden`.

**[P1] No authenticated screen displays its own name.** `AppShell.tsx:306-308` — `<h1>`, `eyebrow` and `subtitle` are all `sr-only`. Every caller passes a title and none render. Below `lg` the sidebar is a closed drawer, so a trainer on a phone has a topbar of Menú/bell/search and no way to know where they are. On desktop it forces every page to invent its own hierarchy — which is why `reports` opens at `<h3>` and `members` at `<h2>`, and why stat-card numbers are the visually dominant element everywhere. It also splits the accessible heading tree from the visual one.
Fix: render the header row above `<main>` — eyebrow at `text-[10px] uppercase tracking-wider`, title as a visible `<h1 className="text-xl font-bold">`, subtitle at `text-sm`. Then normalise every page's first content heading to `<h2>`. Suggested command: `/impeccable layout`.

**[P1] The payment queue is keyboard-unreachable and has no queue-clearing affordances.** `payments/page.tsx:366-370` — rows are `<tr onClick>` with `cursor-pointer`, no `tabIndex`, no `role`, no `onKeyDown`. Selecting a request replaces the list entirely (:285): no "N de M", no prev/next, no auto-advance after approve, and the filter defaults to `"all"` (:87). This is the screen whose entire reason to exist is clearing a queue, and it is the slowest and least accessible surface in the app. `ConfirmDialog` was correctly added for approve — and then the flow around it was built to maximise how many times you see it.
Fix: `tabIndex={0}` + `role="button"` + `aria-label` + Enter/Space `onKeyDown` on rows, or a real `<button>` in a trailing cell; default `activeFilter` to `"pendiente"`; add "Pendiente N de M" plus prev/next in the detail header; auto-advance after approve/reject; convert the "Lista de Verificación" prose (:556-573) into four real checkboxes that gate the Aprobar button. Suggested command: `/impeccable harden`.

**[P1] Date, currency and badge formatting diverge across screens and contradict the spec.** Three date formats, two currency formats, five badge vocabularies. `student/page.tsx:347` renders `${pago.monto} · {pago.fechaInicio} – {pago.fechaFin}` — raw number, raw ISO, raw ISO — on the exact screen where a parent checks whether their payment went through. An admin cross-checking a payment across `/payments` ("$24,00", "24 de julio de 2026"), `/reports` and `/student` ("$24.00", "2026-07-24") normalises by hand every time. The `bg-amber-900/20 text-amber-400` badges (`student:233`, `trainer/attendance:682`, `enroll:321,529`, `add-dependent:272`) are dark-theme values stranded on light cards — the "Pendiente" payment badge, the one a parent most needs to read.
Fix: `formatDate` → `{ day: "2-digit", month: "2-digit", year: "numeric" }` per spec, plus a `formatDateShort` for table cells; replace raw renders at `attendance:268`, `trainer:463`, `reports:663`, `student:347`; replace every money template at `student:105,132,347,414` and `members:313` with `formatCurrency`; delete the bespoke `PagoEstadoBadge` at `student:217-237`; grep-replace all five `bg-amber-900/20 text-amber-400` with `.badge-warning`. Suggested command: `/impeccable polish`.

**[P1] Horizontal overflow on `/payments` at 390px.** Measured: `scrollWidth 450 > innerWidth 390`, caused by the `flex-wrap: nowrap` filter row at `payments/page.tsx:288` (335px container, 430px content). Fix: `flex-wrap: wrap` on that row. Suggested command: `/impeccable adapt`.

**[P2] The closed mobile drawer keeps 11 controls in the tab order.** `AppShell.tsx:181-185` toggles only `translate-x`, leaving `visibility: visible`, `aria-hidden` null and `inert` false. Keyboard focus disappears offscreen. Fix: add `inert` (or `aria-hidden` + `visibility: hidden`) when `!sidebarOpen`. Suggested command: `/impeccable audit`.

## Consistency Audit — 16 deltas

1. **Page headers.** `AppShell.tsx:307` is `sr-only`; but `/unauthorized:40`, `/student/enroll:707,745`, `/student/add-dependent:383`, `/reset-password:113` render large visible `<h1>`s. Two opposed philosophies in one product.
2. **Chrome discontinuity.** `Header.tsx:220-233` `APP_SHELL_ROUTES` is an exact-match Set. `/student` gets the light sidebar; `/student/enroll` and `/student/add-dependent` — reached by buttons on `/student` — get the dark top nav. The chrome flips mid-flow.
3. **Pagination — six implementations, three treatments.** `PaginationControls.tsx`; inline duplicates at `attendance:292-318` and `payments:415-441`; a different variant at `trainer:477-504` and `trainer/attendance:522-550`; three more in `reports`.
4. **Back navigation.** `BackLink` on 9 routes, absent on `/dashboard`, `/trainer`, `/student`, `/trainer/attendance` — which instead buries a centered text link at the page bottom.
5. **Date formats — three.** `formatDate` → "24 de julio de 2026"; raw ISO at `attendance:268`, `trainer:463`, `reports:663`, `student:347`; `formatSessionDate` → "viernes, 24 jul". The spec's dd/mm/yyyy appears nowhere.
6. **Currency — two.** `formatCurrency` → `$24,00` vs raw templates → `$24.00` at `student:347,414` and `members:313`. Both decimal separators ship.
7. **Badges — four vocabularies** plus a fifth green (`bg-emerald-50 text-emerald-700` at `student:217-237`) that is not `cata-state-ok`, plus dark-theme leftovers on light cards.
8. **Status labels duplicated three times.** `reports/page.tsx:70-80` re-declares `PAGOS_VALIDATION_STATUS_STYLES` with a comment saying it was copied from payments.
9. **Filter patterns — five idioms.** Pills with counts, pills without, segmented tabs, preset buttons + conditional date inputs, `<select>`.
10. **Empty states — four treatments,** from card+icon+text+recovery action down to a bare `<p>` at `trainer/attendance:310`.
11. **Loading states — three.** Spinning `Clock` (a clock is not a spinner), spinning `Loader2`, and plain text with no indicator.
12. **Ellipsis.** `"..."` vs `"…"` (U+2026).
13. **Error blocks — four treatments;** only one of the four is a shared component.
14. **Nav labels vs destinations.** Sidebar "Administración" → page "Panel de Control"; sidebar "Dashboard" (English) → "Panel del Entrenador"; "Asistencia" vs "Asistencias"; "Nivel" vs "Niveles" for the identical component.
15. **Button heights are nominal.** `.btn-primary` is `px-5 py-2.5 text-sm` in `globals.css`, but callers override to four distinct real heights, sometimes on one screen.
16. **Feedback channel.** `payments:177-178` fires an inline banner AND a toast for the same approve; members fires toast only; trainer attendance fires inline only.

## Cognitive Load

6 of 8 items fail. Failures: **single focus** (`trainer/page.tsx` fuses 2 quick-action cards + 3 stat cards + a 4-control filter panel + a paginated history table into one scroll), **grouping** (`members:667-907` — one modal contains identity editing with its own save, role switches that auto-save, account state that auto-saves, membership creation with its own save, and a medical-record editor, closing with a footer "Guardar cambios" that belongs to none of them), **visual hierarchy** (with `<h1>` `sr-only`, the largest element on every screen is a stat-card number), **≤4 options**, **working memory** (`payments:285` swaps the list out for the detail — queue position, remaining count and "which one was I on" are all lost), **progressive disclosure** passes, **chunking** passes.

Decision points over 4 options: `trainer/attendance:494-514` — **4 state buttons × 10 roster rows = 40 simultaneous targets**, each row a 4-way exclusive choice presented as four independent toggles. `reports:405-570` — 7 controls before a single result exists. `members:1019-1064` — 6. Admin sidebar — 8. `payments:353-363` — a 7-column table where 3 columns carry no decision weight for approve/reject.

## The Real Usage Scene

**Trainer, one hand, phone, courtside — it does not fit.** No orientation (sidebar is a closed drawer below `lg`, `<h1>` is `sr-only`). Targets are 30px in a `grid grid-cols-2` packing four options into ~150x60px beside the student's name, ten rows deep. Everyone starts `"absent"`. Pagination hides work: 10 per page, but `students` is the whole roster, so submitting from page 1 of a 20-student session silently submits page 2 as absent. No sticky commit — after marking ten students the trainer scrolls the full card to reach "Siguiente". The chat FAB floats over the bottom-right permanently. No draft persistence: all marks are component-local `useState`, so a phone call loses the session. Partial failure reports a count, not names.

**Admin clearing a payment queue on a laptop — it fits worse than it should for the one screen built for a queue.** Four stat cards occupy the viewport before the first pending row. The filter defaults to "all", so clearing begins with a click. Rows are keyboard-inaccessible. Selecting replaces the list; every item costs click → scroll → approve → confirm → read banner → "Volver a la lista" → re-find position. No URL state, so refresh or open-in-new-tab loses filter, page and selection. The verification checklist is prose, not checkboxes, on a split layout where the proof image lives in the other column.

## Persona Red Flags

**Alex (power user, 40 payments to clear, keyboard-fluent)** — `payments:367` cannot be operated by keyboard at all: blocking. No bulk approve, no next/prev inside the detail, no auto-advance. All six paginators are prev/next only with no jump, no page size, no range readout. Zero URL state app-wide. `AppShell.tsx:95-99` — the Ctrl+K palette searches nav link labels only; it cannot jump to a member, a payment or a student, which is the only reason a power user opens a palette. `members:1069` caps the list at `MEMBERS_AGGREGATE_LIMIT` and merely warns, with no way to page past the cap.

**Sam (accessibility, keyboard, screen reader)** — `ProtectedRoute.tsx:57` `text-white/65` on `#F9FAFB`, invisible and not in a live region. `AppShell.tsx:307` sr-only `<h1>` splits the visual and AT heading trees; `reports:408` then opens at `<h3>` under nothing. `payments:366-410` click-only rows. `members:850-868` — the role checkbox is `sr-only`, the visible switch is `aria-hidden`, and the wrapping `<label>` has no focus ring, so keyboard focus lands somewhere invisible. `NotificationBell.tsx:70-117` — no focus trap, no Escape, no outside-click dismissal, and `aria-haspopup="true"` (which means *menu*) on a non-menu popup; identical defects in both user menus. `ToastContainer.tsx:36-43` — `aria-live="polite"` on the container AND `role="alert"` on each child: nested live regions double-announce. `AttendanceStatusChart.tsx:73` — `tabIndex={0}` on `<circle>` with no `:focus-visible` styling. `trainer/attendance:492-515` — four mutually exclusive options in a `<fieldset>` with no `role="radiogroup"`, announcing as four independent toggles. Measured contrast: `/ranking` "Sin asignar" at 2.31:1, `/trainer` CTAs at 3.85:1, plus `text-cata-text/40` and `/45` throughout empty-state copy. Closed mobile drawer keeps 11 focusable controls in the tab order.

**Casey (distracted, mobile)** — no page title below `lg`. `trainer/attendance:494-514` — a 2×2 grid of 30px buttons per student, four mis-tappable targets per row, ten rows. `ChatWidget.tsx:74` at `fixed bottom-5 right-5 z-40 h-14 w-14`, mounted unconditionally at `layout.tsx:44`, permanently covers the bottom-right of every screen including `/login`. `members:630-665` — Contacto, Estudiantes, Estado and Editar are all `hidden sm:table-cell`, so below `sm` the members table is a one-column list with a duplicated edit button crammed under the name. `ToastContainer.tsx:36` — `fixed top-4 right-4 w-full max-w-sm` covers the topbar's Menú and bell on a 360px phone, and auto-dismiss means the only confirmation of an irreversible approve can be missed entirely. `/payments` scrolls sideways by 60px. The attendance wizard has no persistence.

## Minor Observations

- `ChatWidget.tsx:8-11` documents itself as "Mounted once in AppShell.tsx, gated on `session`". It is mounted in `layout.tsx:44` and gated on nothing.
- `tailwind.config.ts:14-40` defines 26 `cata-*` colors; the app uses roughly eight. `cata-gray` is defined as `rgba(255,255,255,0.45)` and used as a *text* color on a light background at `groups-page-utils.ts:102`.
- `globals.css` `.badge` (:110-112) defines a base class no variant extends; `members:648` writes `` `badge ${statusBadge.className}` `` (double application) while `:694` writes `"badge-success"` (single).
- `.btn-primary` declares `hover:bg-cata-red-light` in its `@apply` and then a separate `.btn-primary:hover` rule sets `#E55157` — two competing hover definitions for one class.
- `ConfirmDialog.tsx:28` maps the `danger` variant to `btn-secondary` styling: a destructive confirm is visually quieter than its own Cancel button.
- `Header.tsx:89-96` — three of six `INSTITUTIONAL_LINKS` point at `#inicio`. Dead nav on the public header.
- `attendance-utils.ts:18-32` carries a `@deprecated` field and three helpers referencing mock-era shapes with no live caller.
- `trainer/attendance:692` — `{(!result || result.failed.length === 0) && <div className="mb-8" />}`. Layout by placeholder.
- `AppShell.tsx:246` — collapsed sidebar hides labels via `lg:hidden` but keeps `title=` on the `<Link>`, so collapsed nav depends on native tooltips with ~1s delay and no `aria-label` fallback.
- `reports/page.tsx:369-403` — the tab bar uses plain `<button>`s with no `role="tab"`/`tablist"`/`aria-selected` and no arrow-key navigation.
- `groups/page.tsx` sidebar label is "Gestión de Horarios" while the concept is "grupos" in code and "Grupo" in the domain types. Three names for one thing.
- `/groups` icon buttons (27x27) have no `aria-label`; the accessible name comes only from `title`.
- `GET /api/members` fires before the role guard resolves, producing a 403 console error on an expected path.
- `.bg-subtle-dot` (`globals.css:176`) is defined and never applied — dead CSS.

## Questions to Consider

1. If the sidebar is the only thing telling an admin where they are, why is it the first thing you hide on the device where they are most lost? The design allocates its orientation budget exactly inversely to need. What would this app look like if you designed the phone view first?
2. Levels 1-10 where 1 is the top is the club's proudest and most contested structure. Why is it a string? Nothing in the interface encodes that the scale is ordinal, that 1 is above 10, that levels have capacity (`cuposDisponibles` exists in the data and never becomes form), or that moving up is an achievement. If a parent screenshot-shares one thing from this app, it is their kid's level — and it looks like a dropdown value.
3. Which is the actual product — the payment queue, or the four stat cards above it? If you deleted every stat card tomorrow, which user would file the complaint, and what would they say they lost?
