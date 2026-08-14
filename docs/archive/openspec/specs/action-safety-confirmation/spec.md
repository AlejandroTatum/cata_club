# Action Safety Confirmation Specification

## Purpose

Shared confirmation-dialog pattern and semantic color treatment for
high-consequence actions (payments approve, groups remove-from-group), so
destructive/consequential actions never fire on a single accidental click and
approve reads as a positive action instead of a brand-red default.

## Requirements

### Requirement: Shared Confirmation Dialog Component

The system MUST provide one reusable `ConfirmDialog` component
(`src/components/ConfirmDialog.tsx`) that renders a title, a message, a
confirm control, and a cancel/dismiss control, and MUST NOT invoke its
confirm callback unless the user explicitly activates the confirm control.

#### Scenario: Dialog blocks the action until confirmed

- GIVEN `ConfirmDialog` is open with a pending action
- WHEN the user activates the confirm control
- THEN the pending action's callback fires exactly once

#### Scenario: Dialog is dismissible without side effects

- GIVEN `ConfirmDialog` is open with a pending action
- WHEN the user activates cancel or closes the dialog
- THEN the pending action's callback does not fire
- AND the underlying data is unchanged

### Requirement: Payments Approve Uses Semantic Success Color and Requires Confirmation

`payments/page.tsx`'s approve control MUST use `cata-state-ok` styling
instead of the brand-red `.btn-primary` treatment, and MUST require
confirmation via `ConfirmDialog` before mutating payment status, matching the
friction level of the existing reject flow.

#### Scenario: Approve opens a confirmation before mutating

- GIVEN a pending payment row
- WHEN the admin clicks "Aprobar Pago"
- THEN `ConfirmDialog` opens and no status mutation has occurred yet
- AND only after confirming does the payment status change

#### Scenario: Canceling approve leaves status unchanged

- GIVEN the approve `ConfirmDialog` is open
- WHEN the admin cancels
- THEN the payment status remains "pendiente"

### Requirement: Groups Remove-From-Group Requires Plain Click-to-Confirm

`groups/page.tsx`'s `handleClearAssignment` MUST NOT fire on direct click; it
MUST open `ConfirmDialog` first. Confirmation MUST be a plain click-to-confirm
step with no typed-reason input field — the typed-reason pattern remains
exclusive to payments' reject flow.

#### Scenario: Remove-from-group opens confirm dialog

- GIVEN a student assigned to a group
- WHEN the admin clicks the remove-from-group icon
- THEN `ConfirmDialog` opens instead of removing the student immediately

#### Scenario: Confirming removes the student

- GIVEN the remove-from-group `ConfirmDialog` is open
- WHEN the admin confirms
- THEN the student is removed from the group

#### Scenario: Canceling leaves the assignment intact

- GIVEN the remove-from-group `ConfirmDialog` is open
- WHEN the admin cancels
- THEN the student remains assigned to the group

### Requirement: No Tailwind Config Changes

`ConfirmDialog` and its consumers MUST use only existing `cata-*` classes
(e.g. `cata-state-ok`, `cata-red`, `cata-border`) and MUST NOT add, rename, or
remove any entry in `tailwind.config.ts`.

#### Scenario: Config diff stays empty

- GIVEN this capability's implementation is complete
- WHEN `tailwind.config.ts` is diffed against its pre-change state
- THEN the diff is empty
