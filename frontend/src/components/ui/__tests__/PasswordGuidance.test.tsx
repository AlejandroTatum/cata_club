/**
 * PasswordGuidance — the advisory layer (issue #1395).
 *
 * Covers the part of #1395's contract this component alone owns: the
 * checklist is EXACTLY the pure signal set (one source, no drift), signals
 * tick while typing, the meter walks the five readings, a common password
 * never reads strong — and nothing here blocks anything, because there is
 * no submit to block: the component is a readout.
 *
 * @vitest-environment jsdom
 */

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import PasswordGuidance, { PASSWORD_GUIDANCE_HEADING } from "@/components/ui/PasswordGuidance";
import { buildPasswordCompositionSignals } from "@/lib/identity-validation";

const CHECKLIST = "Recomendaciones para la contraseña";
const METER = "Fortaleza de la contraseña";

/** A controlled harness so the tests type into the same props the pages do. */
function TypingHarness(): React.ReactElement {
  const [password, setPassword] = useState("");
  return (
    <div>
      <input
        aria-label="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <PasswordGuidance password={password} />
    </div>
  );
}

function checklist(): HTMLElement {
  return screen.getByRole("status", { name: CHECKLIST });
}

function advisoryItem(label: string): HTMLElement {
  return within(checklist()).getByText(label).closest("li") as HTMLElement;
}

function meter(): HTMLElement {
  return screen.getByRole("status", { name: METER });
}

/** Filled meter segments, read off the aria-hidden bar inside the live region. */
function filledSegments(): number {
  return meter().querySelectorAll("[class*='bg-state-']").length;
}

describe("PasswordGuidance — the advisory checklist", () => {
  it("renders exactly the pure signal set — one source, no second wording", () => {
    render(<PasswordGuidance password="" />);
    const labels = within(checklist())
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(labels).toEqual(buildPasswordCompositionSignals("").map((signal) => signal.label));
  });

  it("shows every recommendation pending before anything is typed", () => {
    render(<PasswordGuidance password="" />);
    for (const item of checklist().querySelectorAll("li")) {
      expect(item).toHaveAttribute("data-met", "false");
    }
  });

  it("ticks and unticks the signals while the password changes", () => {
    render(<TypingHarness />);
    const input = screen.getByLabelText("Password");

    fireEvent.change(input, { target: { value: "nubesverdes" } });
    expect(advisoryItem("Al menos 12 caracteres")).toHaveAttribute("data-met", "false");
    expect(advisoryItem("Mayúsculas y minúsculas")).toHaveAttribute("data-met", "false");
    expect(advisoryItem("Al menos un número")).toHaveAttribute("data-met", "false");
    expect(advisoryItem("Al menos un símbolo (por ejemplo, ! o #)")).toHaveAttribute(
      "data-met",
      "false",
    );

    fireEvent.change(input, { target: { value: "Nubes-Verdes-2024" } });
    expect(advisoryItem("Al menos 12 caracteres")).toHaveAttribute("data-met", "true");
    expect(advisoryItem("Mayúsculas y minúsculas")).toHaveAttribute("data-met", "true");
    expect(advisoryItem("Al menos un número")).toHaveAttribute("data-met", "true");
    expect(advisoryItem("Al menos un símbolo (por ejemplo, ! o #)")).toHaveAttribute(
      "data-met",
      "true",
    );
  });

  it("names the advisory layer, so it never reads as the enforcing checklist", () => {
    render(<PasswordGuidance password="" />);
    expect(screen.getByText(PASSWORD_GUIDANCE_HEADING)).toBeInTheDocument();
    expect(PASSWORD_GUIDANCE_HEADING).toMatch(/más fuerte/);
    expect(PASSWORD_GUIDANCE_HEADING.toLowerCase()).not.toContain("debe");
    expect(PASSWORD_GUIDANCE_HEADING.toLowerCase()).not.toContain("obligator");
  });
});

describe("PasswordGuidance — the meter", () => {
  it("reads no verdict and fills no segment while the field is empty", () => {
    render(<PasswordGuidance password="" />);
    expect(meter().textContent).toBe("");
    expect(filledSegments()).toBe(0);
  });

  it("walks the five readings — and the bar with them — as the content gets stronger", () => {
    render(<TypingHarness />);
    const input = screen.getByLabelText("Password");

    fireEvent.change(input, { target: { value: "nubesverdes" } });
    expect(meter()).toHaveTextContent("Débil");
    expect(filledSegments()).toBe(1);

    fireEvent.change(input, { target: { value: "nubes1234" } });
    expect(meter()).toHaveTextContent("Aceptable");
    expect(filledSegments()).toBe(2);

    fireEvent.change(input, { target: { value: "Nubes1234" } });
    expect(meter()).toHaveTextContent("Fuerte");
    expect(filledSegments()).toBe(3);

    fireEvent.change(input, { target: { value: "Nubes-Verdes-2024" } });
    expect(meter()).toHaveTextContent("Muy fuerte");
    expect(filledSegments()).toBe(4);
  });

  it("never reads a common password above Débil, however it is dressed up", () => {
    render(<PasswordGuidance password="contrasena1" />);
    expect(meter()).toHaveTextContent("Débil");
  });
});
