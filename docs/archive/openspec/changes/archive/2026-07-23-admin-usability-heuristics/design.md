# Design: Admin Panel Usability Heuristics Fixes (Track C)

## Technical Approach

PR 1 introduces one new plain-controlled component, `ConfirmDialog`
(`src/components/ConfirmDialog.tsx`), consumed locally by `payments/page.tsx`
(approve, `state-ok` variant) and `groups/page.tsx` (remove-from-group,
`danger` variant). No context/store, no portal, no new dependency — matches
the codebase's current no-abstraction convention (`openspec/config.yaml`
context: no Button/Card/Badge/Input layer yet). Each consumer owns its own
`useState` for "is a confirm pending" and defers its existing mutation
handler (`handleApprove`, `handleClearAssignment`) until the dialog's
`onConfirm` fires. PR 2 (dashboard) and PR 3 (consistency pass) are
CSS/JSX-only, reusing `.alert-error`, `.card`, hero-band and `cata-yellow`/
`cata-red` tokens already established by Track A — no new component.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Confirmation state location | Local `useState` in each consumer page | Shared `ConfirmDialogProvider` context | No Context-based modal state exists anywhere in the codebase; 2 consumers don't justify a provider; keeps PR 1 self-contained |
| Variant styling | Internal `variant: "state-ok" \| "danger"` prop maps to `cata-*` classes inside `ConfirmDialog` | Consumer passes a raw `className` | Centralizes token choice in one file so "no new hex, no config edit" is auditable from one place |
| Confirmation depth | Plain click-to-confirm only, no typed-reason field | Typed-reason like payments' reject flow | Resolved by proposal's assumption #1; typed-reason stays reject-only, out of `ConfirmDialog`'s scope |
| Mounting | Conditional inline render (`{open && <ConfirmDialog/>}`), `fixed inset-0` overlay | `createPortal` to `document.body` | No portal usage exists in the codebase; 2 flat page layouts don't need SSR-safe portal complexity |
| Focus management | Bespoke `useEffect` trap: focus confirm button on open, Escape/backdrop closes, focus returns to trigger on close | Add a headless-UI dialog dependency (Radix) | No dialog dependency in `package.json`; disproportionate for a 2-consumer plain dialog; spec asks for baseline a11y only |

## Data Flow — ConfirmDialog Sequence (payments approve)

```
Admin clicks "Aprobar Pago"
   -> payments/page.tsx: setPendingConfirm(true)      (no mutation yet)
   -> ConfirmDialog renders, aria-modal, confirm button auto-focused
Admin clicks Confirm
   -> onConfirm() fires -> handleApprove() -> updatePaymentValidation(...)
   -> setPendingConfirm(false); focus returns to "Aprobar Pago" trigger
Admin clicks Cancel / Escape / backdrop
   -> setPendingConfirm(false) only; no callback; focus returns to trigger
```

Groups mirrors this shape 1:1: `UserMinus` icon click -> open -> Confirm ->
`handleClearAssignment(alumnoId)` -> close.

## File Changes

| File | Action | PR |
|---|---|---|
| `src/components/ConfirmDialog.tsx` | Create | 1 |
| `src/app/payments/page.tsx` | Modify — approve button `.btn-primary` -> `cata-state-ok` styling; `handleApprove` gated behind `ConfirmDialog` | 1 |
| `src/app/groups/page.tsx` | Modify — `handleClearAssignment` (line 139) gated behind `ConfirmDialog`, danger variant | 1 |
| `src/app/dashboard/page.tsx` | Modify — differentiate stat-card (lines 113-145) vs. quick-action-card (154-181) container styling; escalate the 2 `trend: "alert"` stats (Pendientes de Validar, Pagos Pendientes) via `cata-yellow`/`cata-red` border+size, no DOM reorder | 2 |
| `src/app/student/enroll/page.tsx` | Modify — replace bespoke error box (lines 976-985) with `.alert-error` | 3 |
| `src/app/forgot-password/page.tsx` | Modify — rebuild as centered card matching `login`/`register` (`flex min-h-[75vh] items-center justify-center` + `w-full max-w-sm` + `.card p-8 sm:p-9`), add `<Link href="/login" className="btn-ghost">` back-link; still no form/backend call | 3 |
| `src/app/members/page.tsx` | Modify — insert `h2` before the existing lone `h3` (line 457, "Modelo de dominio") | 3 |

## Interfaces / Contracts

```tsx
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;   // default "Confirmar"
  cancelLabel?: string;    // default "Cancelar"
  variant: "state-ok" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}
```

Variant -> class map (existing `cata-*` tokens only, no new hex):
- `state-ok`: confirm button `bg-cata-state-ok text-white hover:bg-cata-state-ok/90` (mirrors `.btn-primary` shape, swaps color source only), heading accent `text-cata-state-ok`.
- `danger`: confirm button reuses `.btn-secondary` structure with `border-cata-red/30 text-cata-red hover:bg-cata-red/10` (identical treatment to payments' existing reject button), heading accent `text-cata-red`.

Consumer wiring (same pattern in both `payments` and `groups`):

```tsx
const [confirmOpen, setConfirmOpen] = useState(false);
// trigger: onClick={() => setConfirmOpen(true)}
<ConfirmDialog
  open={confirmOpen}
  variant="state-ok"
  title="Aprobar pago"
  message="¿Confirma que aprueba este pago? La membresía pasará a activa."
  onConfirm={() => { handleApprove(); setConfirmOpen(false); }}
  onCancel={() => setConfirmOpen(false)}
/>
```

Accessibility baseline: `role="dialog" aria-modal="true"`, `aria-labelledby`
(title id) and `aria-describedby` (message id); Escape triggers the cancel
path; focus moves to the confirm button on open and returns to the trigger
element on close; backdrop click behaves as cancel; Tab/Shift+Tab cycle only
between the dialog's 2 buttons while open.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `ConfirmDialog` | Vitest + RTL: confirm fires `onConfirm` exactly once; cancel/Escape/backdrop never fire it; focus returns to trigger on close |
| Unit | payments approve / groups remove | Assert no mutation before confirm click; assert mutation only after confirm |
| Build | Type/compile safety | `pnpm build` per PR |
| Visual (manual) | Dashboard escalation, forgot-password fidelity, header ranks | Manual smoke per PR 2/3, per config's carve-out for CSS-only changes; exploration's own risk note also recommends a contrast/click-target pass in `sdd-verify` |
| Strict TDD | RED test before gating each consumer's mutation behind `ConfirmDialog` | New testable behavior (confirm gating) — write failing test first per `config.apply.tdd` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary in this change.

## PR Boundaries and 400-Line Budget

Each PR stays independently mergeable to `main`, no ordering dependency
between PRs (per proposal). PR 1 is the highest risk for the 400-line budget
(new component + 2 consumers, per proposal's risk table). `ConfirmDialog`
itself is kept intentionally small (~70-90 lines: props, focus-trap effect,
2-button JSX) so each consumer's diff (button restyle + ~15-20 lines of
gating state) stays additive, not systemic. **Fallback**: if the pre-PR
line-count check exceeds 400, split into **PR 1a** (`ConfirmDialog` +
payments) and **PR 1b** (groups only) — both still independently mergeable
to `main`, no ordering dependency, per the proposal's documented split.
PR 2 and PR 3 are single-file, styling/JSX-only diffs — low risk, no split
anticipated.

## Migration / Rollout

No migration required. Each PR is `git revert`-able independently — the 3
PRs touch disjoint file sets; only `payments/page.tsx` and `groups/page.tsx`
share the new `ConfirmDialog` import, both inside PR 1, so reverting PR 1
cleanly removes the component and both consumers together.

## Open Questions

- [ ] None blocking — the proposal's 3 open questions were pre-resolved by
      its stated assumptions (plain click-confirm for groups; styling-only
      dashboard escalation, no reorder; forgot-password fidelity-only, real
      reset flow deferred to a future change).
