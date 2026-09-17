import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardNavigation, PersonIdentityFields } from "../wizard-fields";
import { PHONE_LOCAL_HINT } from "@/lib/identity-validation";

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
// Issue #1028, unified across every adopting site by #1296 — the phone field
// of the identity step carries an Ecuador flag and a fixed `+593` inside the
// control, and the editable value is ONLY the local digits that follow: no
// leading 0, no repeated 593. A pasted/autofilled value in any of the three
// shapes (`+593…`, `593…`, `0…`) cleans to the same digits — `PhoneField`'s
// own contract, exercised here through `PersonIdentityFields`.
// ---------------------------------------------------------------------------

describe("PersonIdentityFields — the shared PhoneField (#1028, #1296)", () => {
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

  it("rides the Ecuador mark and a fixed +593 inside the phone field's left edge", () => {
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

  it("shows the one local-digits hint and the nine-digit placeholder, no leading 0", () => {
    renderIdentity();

    const phone = screen.getByLabelText(/^Teléfono/);
    expect(phone).toHaveAttribute("placeholder", "Por ejemplo: 991234567");
    expect(screen.getByText(PHONE_LOCAL_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/también acepta \+593/i)).not.toBeInTheDocument();
  });

  it("cleans a pasted/autofilled value in any of the three shapes to the same nine digits", () => {
    const onTelefonoChange = vi.fn();
    renderIdentity({ onTelefonoChange });

    const phone = screen.getByLabelText(/^Teléfono/);
    fireEvent.change(phone, { target: { value: "+593 99 123 4567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");

    fireEvent.change(phone, { target: { value: "593991234567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");

    // A leading-0 local form is cleaned the same way — no longer rejected.
    fireEvent.change(phone, { target: { value: "0991234567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");

    // The correct nine digits pass through exactly as typed.
    fireEvent.change(phone, { target: { value: "991234567" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");

    // Letters never land.
    fireEvent.change(phone, { target: { value: "99a12345 67" } });
    expect(onTelefonoChange).toHaveBeenLastCalledWith("991234567");
  });
});
