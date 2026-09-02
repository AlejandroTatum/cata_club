/**
 * Stepper — named steps at 32px, with done / current / upcoming states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Stepper from "@/components/ui/Stepper";
import { committedHeight } from "./ui-test-utils";

const STEPS = ["Tipo", "Estudiante", "Contacto", "Membresía", "Confirmar"];

function pillFor(name: string): HTMLElement {
  return screen.getByText(name);
}

describe("Stepper — committed dimensions", () => {
  it("renders every step pill at 32px", () => {
    render(<Stepper steps={STEPS} current={2} label="Pasos de la inscripción" />);
    for (const step of STEPS) {
      expect(committedHeight(pillFor(step))).toBe("32px");
    }
  });
});

describe("Stepper — states", () => {
  it("marks earlier steps done, the current one current, the rest upcoming", () => {
    render(<Stepper steps={STEPS} current={3} label="Pasos" />);
    expect(pillFor("Tipo")).toHaveAttribute("data-state", "done");
    expect(pillFor("Estudiante")).toHaveAttribute("data-state", "done");
    expect(pillFor("Contacto")).toHaveAttribute("data-state", "current");
    expect(pillFor("Membresía")).toHaveAttribute("data-state", "upcoming");
    expect(pillFor("Confirmar")).toHaveAttribute("data-state", "upcoming");
  });

  it("paints the current step coal with a ball disc — not red", () => {
    render(<Stepper steps={STEPS} current={1} label="Pasos" />);
    const current = pillFor("Tipo");
    expect(current).toHaveClass("bg-coal");
    expect(current.className).not.toMatch(/red/);
    expect(current.querySelector("span")).toHaveClass("bg-ball");
  });

  it("paints done steps with the ok state pair", () => {
    render(<Stepper steps={STEPS} current={2} label="Pasos" />);
    expect(pillFor("Tipo")).toHaveClass("text-state-ok");
    // #874: the fill lives on the PILL now, not only on its disc — a
    // completed step reads as done before anyone reads the label inside it.
    expect(pillFor("Tipo")).toHaveClass("bg-state-ok-bg");
    expect(pillFor("Tipo").querySelector("span")).toHaveClass("bg-state-ok-bg");
  });

  it("paints upcoming steps sunken, not paper (#874)", () => {
    render(<Stepper steps={STEPS} current={1} label="Pasos" />);
    const pending = pillFor("Estudiante");
    expect(pending).toHaveAttribute("data-state", "upcoming");
    expect(pending).toHaveClass("bg-sunken");
    expect(pending.className).not.toMatch(/\bbg-paper\b/);
  });

  it("shows the step number on pending steps and a check on completed ones", () => {
    render(<Stepper steps={STEPS} current={2} label="Pasos" />);
    expect(pillFor("Estudiante").querySelector("span")?.textContent).toBe("2");
    expect(pillFor("Tipo").querySelector("span")?.textContent).toBe("");
    expect(pillFor("Tipo").querySelector("svg")).not.toBeNull();
  });
});

describe("Stepper — semantics", () => {
  it("is an ordered list with an accessible name", () => {
    render(<Stepper steps={STEPS} current={1} label="Pasos de la inscripción" />);
    expect(screen.getByRole("list", { name: "Pasos de la inscripción" }).tagName).toBe("OL");
  });

  it("flags only the current step with aria-current", () => {
    render(<Stepper steps={STEPS} current={4} label="Pasos" />);
    const flagged = screen
      .getAllByRole("listitem")
      .flatMap((item) => Array.from(item.querySelectorAll("[aria-current='step']")));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent("Membresía");
  });

  it("names its steps instead of numbering them", () => {
    render(
      <Stepper
        steps={["Horario · Lunes 15:00", "Pasar lista", "Confirmar"]}
        current={2}
        label="Pasos"
      />,
    );
    expect(screen.getByText("Horario · Lunes 15:00")).toBeInTheDocument();
    expect(screen.queryByText("Paso 1 de 3")).not.toBeInTheDocument();
  });

  it("draws one connector fewer than it has steps", () => {
    const { container } = render(<Stepper steps={STEPS} current={1} label="Pasos" />);
    expect(container.querySelectorAll("span.w-3")).toHaveLength(STEPS.length - 1);
  });
});
