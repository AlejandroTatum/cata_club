import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WizardNavigation } from "../wizard-fields";

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

