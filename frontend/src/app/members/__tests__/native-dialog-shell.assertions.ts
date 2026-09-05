/**
 * Shared assertion for the `<dialog>` shell/body chain used by
 * `NativeDialogShell.test.tsx` (MedicalRecordDialog, PaymentsDialog) and
 * `MembersPage.test.tsx` (MemberEditDialog) — extracted so the same
 * structural check is not hand-copied across all three call sites. It used
 * to be, and touching one line in each copy at once (issue #1036) is what
 * pushed New Code Duplication over SonarCloud's 3% gate: three near-identical
 * blocks duplicating each other.
 *
 * Regression lock for issues #856 and #1036: on several iPhone browsers,
 * Ficha médica, Pagos and Editar miembro opened with the header and close
 * button visible but the body collapsed or off-screen. jsdom cannot measure
 * real layout, so this asserts the STRUCTURE that makes the height chain
 * definite in WebKit rather than the resulting pixels — see
 * `useNativeDialog.ts`'s doc comments for the CSS reasoning.
 *
 * #856's fix (removing `h-fit`, adding `min-h-0` — see #952) gave the shell a
 * definite `max-h` but did not close the defect on a real device: the body
 * still used `flex-1`, i.e. `flex: 1 1 0%`. iOS WebKit resolves that `0%`
 * basis as a definite zero against the `position: fixed` `<dialog>`, so the
 * body contributes nothing to the dialog's intrinsic height and there is no
 * free space left for `flex-grow` to hand out. Measured on a real iPhone
 * (iOS 18.7, viewport 695px): `flex-1` (`flex: 1 1 0%`) gives a 196px dialog
 * with a 32px body — exactly its vertical padding, nothing else. `flex-auto`
 * (`flex: 1 1 auto`) gives a 665px dialog with a 501px body, because an
 * `auto` basis is the content size and can never resolve to zero. See issue
 * #1036 for the full measurement table.
 */

import { expect } from "vitest";

/**
 * Walks from the scroll container up to (but excluding) the `<dialog>`
 * itself, asserting no wrapper reintroduces the two shapes that break a
 * WebKit flex column: a second `overflow-hidden` boundary (only the shell
 * may clip), or a `flex-1` growing child with no `min-h-0` to let it shrink.
 * Passes trivially today because the body is a direct child of `<dialog>` in
 * all three components — it exists to catch a FUTURE intermediate wrapper,
 * the exact shape issue #856 warns could reintroduce the bug in only one of
 * the three dialogs.
 */
function assertNoBrokenIntermediateWrapper(dialog: HTMLElement, scrollContainer: HTMLElement): void {
  let node = scrollContainer.parentElement;
  while (node && node !== dialog) {
    expect(node).not.toHaveClass("overflow-hidden");
    if (node.classList.contains("flex-1")) {
      expect(node).toHaveClass("min-h-0");
    }
    node = node.parentElement;
  }
}

/**
 * Asserts the whole shell/body chain shared by `MedicalRecordDialog`,
 * `PaymentsDialog` and `MemberEditDialog`: the shell has no fit-content
 * height, the body is a `flex-auto min-h-0` scroll container (never
 * `flex-1`), it is a direct child of the shell, and no intermediate wrapper
 * reintroduces a broken clip or growing child. Returns the body so callers
 * can run their own dialog-specific checks (e.g. locating the footer by
 * `body.nextElementSibling`) without a second `querySelector`.
 */
export function expectSharedNativeDialogChain(dialog: HTMLElement): HTMLElement {
  expect(dialog).not.toHaveClass("h-fit");
  expect(dialog).toHaveClass("flex", "flex-col", "overflow-hidden");

  const body = dialog.querySelector(".overflow-y-auto") as HTMLElement;
  expect(body).toHaveClass("flex-auto", "min-h-0", "overflow-y-auto", "overscroll-contain");
  expect(body).not.toHaveClass("flex-1");
  expect(body.parentElement).toBe(dialog);

  assertNoBrokenIntermediateWrapper(dialog, body);

  return body;
}
