/**
 * Regression lock for issues #856 and #1036: on several iPhone browsers,
 * Ficha médica, Pagos and Editar miembro opened with the header and close
 * button visible but the body collapsed or off-screen. jsdom cannot measure
 * real layout, so these tests assert the STRUCTURE that makes the height
 * chain definite in WebKit rather than the resulting pixels — see
 * `useNativeDialog.ts`'s doc comments for the CSS reasoning and
 * `native-dialog-shell.assertions.ts` for the shared shell/body chain check
 * and the full iPhone measurement numbers.
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
import { expectSharedNativeDialogChain } from "./native-dialog-shell.assertions";

const ACCOUNT: MemberAccount = {
  id: "1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  telefono: "0999999999",
  estudiantes: [],
};

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
    //
    // The grow basis must be `flex-auto` (`flex: 1 1 auto`), never `flex-1`
    // (`flex: 1 1 0%`, issue #1036): on iOS WebKit a `0%` basis resolves as a
    // definite zero against the `position: fixed` dialog, so the body ends up
    // exactly at its 32px vertical padding instead of the 501px it measures
    // with `flex-auto`.
    expect(NATIVE_DIALOG_BODY_CLASS).not.toMatch(/(?:^|\s)flex-1(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)flex-auto(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)min-h-0(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)overflow-y-auto(?:\s|$)/);
    expect(NATIVE_DIALOG_BODY_CLASS).toMatch(/(?:^|\s)overscroll-contain(?:\s|$)/);
  });
});

describe("MedicalRecordDialog — shared shell chain (issue #856)", () => {
  it("dialog has no fit-content height, and the body is a min-h-0 flex-auto scroll container", () => {
    render(<MedicalRecordDialog account={ACCOUNT} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expectSharedNativeDialogChain(dialog);
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

  it("dialog has no fit-content height, and the body is a min-h-0 flex-auto scroll container", () => {
    render(<PaymentsDialog account={ACCOUNT} onClose={() => {}} {...membresiaCallbacks} />);

    const dialog = screen.getByRole("dialog");
    expectSharedNativeDialogChain(dialog);
  });

  it("keeps the header and footer as shrink-0 siblings of the scrolling body", () => {
    render(<PaymentsDialog account={ACCOUNT} onClose={() => {}} {...membresiaCallbacks} />);

    const dialog = screen.getByRole("dialog");
    const [header, , footer] = Array.from(dialog.children) as HTMLElement[];
    expect(header).toHaveClass("shrink-0");
    expect(footer).toHaveClass("shrink-0");
  });
});
