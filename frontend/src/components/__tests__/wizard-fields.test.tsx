import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BirthDateField, WizardInput } from "@/components/wizard-fields";

const base = {
  idPrefix: "t",
  label: "Campo",
  value: "",
  onChange: () => undefined,
  disabled: false,
};

describe("WizardInput describedBy", () => {
  it("appends the extra id after the field's own message", () => {
    render(<WizardInput {...base} hint="Pista" describedBy="extra-id" />);
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-describedby",
      "t-campo-message extra-id",
    );
  });

  it("points only at the extra id when the field has no message", () => {
    render(<WizardInput {...base} describedBy="extra-id" />);
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-describedby",
      "extra-id",
    );
  });

  it("leaves aria-describedby unset when nothing describes the field", () => {
    render(<WizardInput {...base} />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby");
  });
});

describe("hint tone", () => {
  it("renders a neutral hint by default and a warn hint on request", () => {
    const { rerender } = render(<WizardInput {...base} hint="Pista" />);
    expect(screen.getByText("Pista")).toHaveClass("text-ink-3");
    rerender(<WizardInput {...base} hint="Pista" hintTone="warn" />);
    expect(screen.getByText("Pista")).toHaveClass("text-state-warn");
  });

  it("supports the tone on the birth-date field too", () => {
    render(<BirthDateField {...base} hint="14 años" hintTone="warn" />);
    expect(screen.getByText("14 años")).toHaveClass("text-state-warn");
  });
});
