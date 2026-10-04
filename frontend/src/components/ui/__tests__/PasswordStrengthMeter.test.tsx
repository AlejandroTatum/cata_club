import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PasswordStrengthMeter, {
  getPasswordMeterLevel,
} from "../PasswordStrengthMeter";

function filledSegments(container: HTMLElement): number {
  return container.querySelectorAll('[data-segment="filled"]').length;
}

describe("getPasswordMeterLevel", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "short"],
    ["Aa1!", "short"],
    ["qwerty123", "short"],
    ["nubesverd", "fair"],
    ["Nubes-Verdes-2024", "strong"],
  ])("reads %j as %s", (password, level) => {
    expect(getPasswordMeterLevel(password)).toBe(level);
  });
});

describe("PasswordStrengthMeter", () => {
  it("renders three empty segments and the minimum-length line for an empty field", () => {
    const { container } = render(
      <PasswordStrengthMeter value="" id="pw-meter" />,
    );
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(3);
    expect(filledSegments(container)).toBe(0);
    expect(screen.getByText("Al menos 8 caracteres.")).toHaveAttribute(
      "id",
      "pw-meter",
    );
  });

  it("fills one segment and counts what is missing while short", () => {
    const { container } = render(
      <PasswordStrengthMeter value="abc" id="pw-meter" />,
    );
    expect(filledSegments(container)).toBe(1);
    expect(
      screen.getByText("3 de 8 caracteres — faltan 5."),
    ).toBeInTheDocument();
  });

  it("says 'falta 1' when a single character is missing", () => {
    render(<PasswordStrengthMeter value="abcdefg" id="pw-meter" />);
    expect(
      screen.getByText("7 de 8 caracteres — falta 1."),
    ).toBeInTheDocument();
  });

  it("fills two segments for a valid password and invites lengthening it (usted)", () => {
    const { container } = render(
      <PasswordStrengthMeter value="nubesverd" id="pw-meter" />,
    );
    expect(filledSegments(container)).toBe(2);
    expect(
      screen.getByText(
        "Válida. Para que sea segura, alárgala o mezcla mayúsculas, números y símbolos.",
      ),
    ).toBeInTheDocument();
  });

  it("fills all three segments for a strong password", () => {
    const { container } = render(
      <PasswordStrengthMeter value="Nubes-Verdes-2024" id="pw-meter" />,
    );
    expect(filledSegments(container)).toBe(3);
    expect(screen.getByText("Contraseña segura.")).toBeInTheDocument();
  });

  it("flags a common password as unusable instead of 'valid'", () => {
    const { container } = render(
      <PasswordStrengthMeter value="qwerty123" id="pw-meter" />,
    );
    expect(filledSegments(container)).toBe(1);
    expect(screen.getByText(/más usadas/)).toBeInTheDocument();
  });

  it("announces only the level in a hidden live region, never the count", () => {
    const { rerender } = render(
      <PasswordStrengthMeter value="abc" id="pw-meter" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Nivel de la contraseña: corta.");
    expect(status).toHaveClass("sr-only");
    rerender(<PasswordStrengthMeter value="abcd" id="pw-meter" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nivel de la contraseña: corta.",
    );
    rerender(<PasswordStrengthMeter value="Nubes-Verdes-2024" id="pw-meter" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nivel de la contraseña: segura.",
    );
  });
});
