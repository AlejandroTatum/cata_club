/**
 * Regression lock for issue #856: on several iPhone browsers, Ficha médica,
 * Pagos and Editar miembro opened with the header and close button visible
 * but the body collapsed or off-screen. jsdom cannot measure real layout, so
 * these tests assert the STRUCTURE that makes the height chain definite in
 * WebKit rather than the resulting pixels — see `useNativeDialog.ts`'s
 * updated doc comments for the CSS reasoning.
 *
 * `MedicalRecordDialog` and `PaymentsDialog` render the shared shell
 * directly and are exercised here with no students, which keeps both free of
 * `MedicalRecordEditor`/`StudentMembershipActions`' own API-backed content —
 * this suite is about the shell/body wrapper chain, not their internals
 * (already covered by `MedicalRecordEditor.test.tsx` and friends). The third
 * dialog sharing this container, `MemberEditDialog`, is not exported from
 * `page.tsx`; its own chain is asserted in `MembersPage.test.tsx`, next to
 * the rest of its coverage.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "../useNativeDialog";
import MedicalRecordDialog from "../MedicalRecordDialog";
import PaymentsDialog from "../PaymentsDialog";
import type { MemberAccount } from "../members-utils";

const ACCOUNT: MemberAccount = {
  id: "1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  telefono: "0999999999",
  estudiantes: [],
};

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

describe("shared native dialog shell — definite height chain (issue #856)", () => {
  it("gives the shell a definite max-height instead of a fit-content one", () => {
    // `h-fit` (`height: fit-content`) is the non-definite height WebKit
    // fails to resolve a `flex-1` child against — see `NATIVE_DIALOG_SHELL_CLASS`.
    expect(NATIVE_DIALOG_SHELL_CLASS).not.toMatch(/(?:^|\s)h-fit(?:\s|$)/);
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/(?:^|\s)flex(?:\s|$)/);
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/(?:^|\s)flex-col(?:\s|$)/);
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/(?:^|\s)overflow-hidden(?:\s|$)/);
    // The cap is a real length: the viewport-height variable minus safe-area
    // insets, never just `max-h-full` or similar.
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/max-h-\[calc\(var\(--dialog-viewport-height/);
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/env\(safe-area-inset-top\)/);
    expect(NATIVE_DIALOG_SHELL_CLASS).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("lets the body shrink below its content height so it can scroll instead of collapsing", () => {
    // `min-h-0` overrides the flex default `min-height: auto`, which is what
    // stopped WebKit from ever handing this child less than its full,
    // unscrolled content height.
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)flex-1(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)min-h-0(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)overflow-y-auto(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)overscroll-contain(?:\s|$)/);
  });
});

describe("MedicalRecordDialog — shared shell chain (issue #856)", () => {
  it("dialog has no fit-content height, and the body is a min-h-0 flex-1 scroll container", () => {
    render(<MedicalRecordDialog account={ACCOUNT} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveClass("h-fit");
    expect(dialog).toHaveClass("flex", "flex-col", "overflow-hidden");

    const body = dialog.querySelector(".overflow-y-auto") as HTMLElement;
    expect(body).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "overscroll-contain");
    expect(body.parentElement).toBe(dialog);

    assertNoBrokenIntermediateWrapper(dialog, body);
  });

  it("keeps the header and footer as shrink-0 siblings of the scrolling body", () => {
    render(<MedicalRecordDialog account={ACCOUNT} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const [header, , footer] = Array.from(dialog.children) as HTMLElement[];
    expect(header).toHaveClass("shrink-0");
    expect(footer).toHaveClass("shrink-0");
  });
});

describe("PaymentsDialog — shared shell chain (issue #856)", () => {
  const membresiaCallbacks = {
    onMembershipCreated: () => {},
    onDebtRegularized: () => {},
    onMembresiaChanged: () => {},
  };

  it("dialog has no fit-content height, and the body is a min-h-0 flex-1 scroll container", () => {
    render(<PaymentsDialog account={ACCOUNT} onClose={() => {}} {...membresiaCallbacks} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveClass("h-fit");
    expect(dialog).toHaveClass("flex", "flex-col", "overflow-hidden");

    const body = dialog.querySelector(".overflow-y-auto") as HTMLElement;
    expect(body).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "overscroll-contain");
    expect(body.parentElement).toBe(dialog);

    assertNoBrokenIntermediateWrapper(dialog, body);
  });

  it("keeps the header and footer as shrink-0 siblings of the scrolling body", () => {
    render(<PaymentsDialog account={ACCOUNT} onClose={() => {}} {...membresiaCallbacks} />);

    const dialog = screen.getByRole("dialog");
    const [header, , footer] = Array.from(dialog.children) as HTMLElement[];
    expect(header).toHaveClass("shrink-0");
    expect(footer).toHaveClass("shrink-0");
  });
});
