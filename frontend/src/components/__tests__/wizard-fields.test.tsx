import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardNavigation, PersonIdentityFields } from "../wizard-fields";
import { PHONE_LOCAL_HINT, PHONE_ENROLL_LOCAL_HINT } from "@/lib/identity-validation";

// Component-level tests for `wizard-fields.tsx`. The JSX-free helpers
// (`slugifyLabel`) stay in `wizard-fields.test.ts`; everything here renders
// React, so it lives in a `.tsx`.

// ---------------------------------------------------------------------------
// #1027 — the footer's blocked-reason geometry. The sentence's copy is owned
// by `describeStepBlocker` (asserted over in `enroll-utils.test.ts`) and is
// pinned verbatim by `EnrollPage.test.tsx`; what THIS file locks is where the
// footer puts it: a full-width line above the button row, right-aligned over
// the control it explains — never again a `max-w-xs` column under the button,
// which is what broke the sentence into short centred-looking lines.
// ---------------------------------------------------------------------------

describe("WizardNavigation — the blocked reason's geometry (#1027)", () => {
  function navigation(overrides: Partial<Parameters<typeof WizardNavigation>[0]> = {}): React.ReactElement {
    return (
      <WizardNavigation
        formErrors={[]}
        isFirst={false}
        isLast={false}
        submitting={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
        submitButton={<button type="submit">Confirmar inscripción</button>}
        {...overrides}
      />
    );
  }

  it("renders the reason full-width above the button row, uncapped", () => {
    render(
      navigation({
        nextDisabled: true,
        nextBlockedReason:
          "Para continuar, revise: Fecha de nacimiento, Cédula de identidad y Teléfono.",
      }),
    );

    const reason = screen.getByText(/para continuar, revise:/i);
    expect(reason.className).toContain("text-right");
    expect(reason.className).toContain("text-base");
    // The cap that squeezed the sentence into 320px is gone.
    expect(reason.className).not.toContain("max-w-xs");

    // And the line precedes the button it explains.
    const siguiente = screen.getByRole("button", { name: /siguiente/i });
    // eslint-disable-next-line no-bitwise
    expect(reason.compareDocumentPosition(siguiente) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stays off the screen entirely while the step is complete", () => {
    render(navigation({ nextDisabled: false }));
    expect(screen.queryByText(/para continuar/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeEnabled();
  });

  it("explains a disabled submit with the same geometry on the final step", () => {
    render(
      navigation({
        isLast: true,
        submitBlocked: true,
        submitBlockedReason: "Para continuar, marque la casilla de confirmación.",
      }),
    );

    const reason = screen.getByText(/marque la casilla de confirmación/i);
    expect(reason.className).toContain("text-right");
    expect(reason.className).not.toContain("max-w-xs");
    expect(reason.className).toContain("mb-section");
  });
});

// ---------------------------------------------------------------------------
// #1028 — the phone field of the identity step carries an Ecuador flag and a
// fixed `+593` inside the control. The adornment is decoration with a job: it
// replaces the hint text that used to teach the accepted formats, while the
// value semantics (local number in, local number out, #855 normalization) are
// untouched — those are `WizardInput`'s own tests.
// ---------------------------------------------------------------------------

describe("PersonIdentityFields — the +593 prefix treatment (#1028)", () => {
  function renderIdentity(overrides: Partial<Parameters<typeof PersonIdentityFields>[0]> = {}): void {
    render(
      <PersonIdentityFields
        idPrefix="p"
        disabled={false}
        nombres=""
        apellidos=""
        fechaNacimiento=""
        cedula=""
        telefono=""
        onNombresChange={vi.fn()}
        onApellidosChange={vi.fn()}
        onFechaNacimientoChange={vi.fn()}
        onCedulaChange={vi.fn()}
        onTelefonoChange={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("rides the Ecuador mark and a fixed +593 inside the phone field's left edge (shared mode)", () => {
    renderIdentity();

    const phone = screen.getByLabelText(/^Teléfono/);
    // The input clears the adornment with the shared padding step.
    expect(phone.className).toContain("pl-20");

    // The adornment is the field's decorative left half: the native Ecuador
    // symbol (the first hand-drawn tricolor read as Colombia — the bands are
    // identical) + the code. No hand-drawn flag rectangle may return.
    const adornment = phone.parentElement?.querySelector<HTMLElement>("span[aria-hidden='true']");
    expect(adornment).not.toBeNull();
    expect(adornment?.textContent).toContain("🇪🇨");
    expect(adornment?.textContent).toContain("+593");
    expect(adornment?.querySelector("svg")).toBeNull();
  });

  it("keeps the label as the phone field's single accessible name", () => {
    renderIdentity();

    const phone = screen.getByLabelText(/^Teléfono/);
    expect(phone).toHaveAttribute("id", "p-telefono");
    // The description is the hint's message id — never the adornment, which is
    // aria-hidden and contributes nothing assistive technology can hear.
    expect(phone).toHaveAttribute("aria-describedby", "p-telefono-message");
  });

  it("swaps the format-teaching hint for the local-digits instruction (shared mode)", () => {
    renderIdentity();

    expect(screen.getByText(PHONE_LOCAL_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/también acepta \+593/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // `phoneFormat="local"` — the public self-service enrollment. The field
  // shows 🇪🇨 + the fixed `+593`, and the editable value is ONLY the nine
  // mobile digits that follow: no leading 0, no repeated 593. The #855
  // masking — the layer that silently normalized an autofilled `+593…` — is
  // retired for this field so a duplicated entry stays as typed for the step
  // rule to reject with its named message.
  // -------------------------------------------------------------------------
  it("shows the fixed flag + +593 prefix and the nine-digit hint in local mode", () => {
    renderIdentity({ phoneFormat: "local" });

    const phone = screen.getByLabelText(/^Teléfono/);
    const adornment = phone.parentElement?.querySelector<HTMLElement>("span[aria-hidden='true']");
    expect(adornment?.textContent).toContain("🇪🇨");
    expect(adornment?.textContent).toContain("+593");
    // The placeholder teaches the nine editable digits, no trunk 0.
    expect(phone).toHaveAttribute("placeholder", "Por ejemplo: 991234567");
    expect(screen.getByText(PHONE_ENROLL_LOCAL_HINT)).toBeInTheDocument();
  });

  it("strips non-digits but never normalizes or truncates in local mode", () => {
    const onTelefonoChange = vi.fn();
    renderIdentity({ phoneFormat: "local", onTelefonoChange });

    const phone = screen.getByLabelText(/^Teléfono/);
    // The autofill case: separators and the plus are stripped, the 593 form
    // stays 593-leading and UNTRUNCATED — visibly wrong, for the rule to name.
    fireEvent.change(phone, { target: { value: "+593 99 123 4567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("593991234567");

    // A leading-0 local form stays as typed — the rule rejects it by name.
    fireEvent.change(phone, { target: { value: "0991234567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("0991234567");

    // The correct nine digits pass through exactly as typed.
    fireEvent.change(phone, { target: { value: "991234567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");

    // Letters never land.
    fireEvent.change(phone, { target: { value: "99a12345 67" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");
  });
});
