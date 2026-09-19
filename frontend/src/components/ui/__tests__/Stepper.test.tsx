/**
 * Stepper — named steps at 32px, with done / current / upcoming states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("carries the pending disc in ink-3-strong, not ink-3 (#1275)", () => {
    // `text-ink-3` on `bg-state-neutral-bg` measures 4.0:1 — under AA. The
    // sibling label two lines up already takes `text-ink-3-strong` for the
    // same reason; the disc was the one piece left behind.
    render(<Stepper steps={STEPS} current={1} label="Pasos" />);
    const disc = pillFor("Estudiante").querySelector("span") as HTMLElement;
    expect(disc).toHaveClass("text-ink-3-strong");
    expect(Array.from(disc.classList)).not.toContain("text-ink-3");
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

// #1321 — the stepper is navigable: a visitor can jump back to a step it
// has already completed by touching its pill.
describe("Stepper — navigable (#1321)", () => {
  it("calls onStepClick with the index of a completed step when clicked", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Estudiante" }));

    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it("does not turn the current step into a button", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    expect(screen.queryByRole("button", { name: "Contacto" })).not.toBeInTheDocument();
  });

  it("does not turn a future step into a button", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    expect(screen.queryByRole("button", { name: "Membresía" })).not.toBeInTheDocument();
  });

  it("still flags the current step with aria-current once the stepper is navigable", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    expect(pillFor("Contacto")).toHaveAttribute("aria-current", "step");
  });

  it("renders no buttons at all without onStepClick — unchanged from before #1321", () => {
    render(<Stepper steps={STEPS} current={3} label="Pasos" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

// #1321 — below `sm:` the wrapped pill row is replaced by a one-line phase
// summary plus a row of dots, so the five pills never split across lines.
describe("Stepper — compact phone rendering (#1321)", () => {
  it("names the current phase as 'Paso N de M · Label'", () => {
    render(<Stepper steps={STEPS} current={3} label="Pasos" />);

    expect(screen.getByText("Paso 3 de 5 · Contacto")).toBeInTheDocument();
  });

  it("lets a completed dot reopen its step too", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Volver a Estudiante" }));

    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it("does not offer a dot for the current or a future step", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    expect(screen.queryByRole("button", { name: "Volver a Contacto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Volver a Membresía" })).not.toBeInTheDocument();
  });

  // #1321 / #317-#31: the enroll wizard's own step 1 is not a committed step
  // count yet (choosing "Representante" there still adds a step), so its
  // header never says "Paso 1 de N" — the compact summary must be able to
  // make the same promise.
  it("omits the total when showCount is false, same as an uncommitted step count", () => {
    render(<Stepper steps={STEPS} current={1} label="Pasos" showCount={false} />);

    expect(screen.getByText("Paso 1 · Tipo")).toBeInTheDocument();
    expect(screen.queryByText(/paso 1 de \d/i)).not.toBeInTheDocument();
  });
});
