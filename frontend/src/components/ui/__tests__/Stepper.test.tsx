/**
 * Stepper — named steps at 32px, with done / current / upcoming states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

// #1332 (R2-001): `position` / `done` / `active` / `clickable` used to be
// computed twice, once per render — a fifth field added to one loop and not
// the other would silently diverge the two. This locks the wide pill and the
// compact dot to the SAME `data-state` for every step, so any future
// divergence between the two derivations fails here.
describe("Stepper — one state derivation feeds both renders (#1332 R2-001)", () => {
  it("agrees on data-state between the wide pill and the compact dot for every step", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    const wideList = screen.getByRole("list", { name: "Pasos" });
    const compactRow = screen.getByTestId("stepper-compact");
    const pillItems = within(wideList).getAllByRole("listitem");
    const dots = compactRow.querySelectorAll("[data-state]");

    STEPS.forEach((step, index) => {
      const pillState = pillItems[index].querySelector("[data-state]")?.getAttribute("data-state");
      expect(dots[index].getAttribute("data-state")).toBe(pillState);
    });
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

// #1332 (R4-001, review advisory de #1331): la píldora compacta completada
// era un `<button>` de 8px (`h-2 w-2`) con `gap-1.5`, en el único breakpoint
// donde existe — táctil. `min-h-[24px]` (`MIN_TARGET_CLASS`,
// `lib/target-size.ts`) es el piso del proyecto, pero ese control es
// icon-only (ningún texto adentro), la misma excepción que el propio
// `target-size.ts` documenta para el checkbox de `EnrollPage` — un cuadrado
// `h-6 w-6` (24px), no `min-h` solo.
describe("Stepper — compact dot touch target (#1332 R4-001)", () => {
  it("gives a completed dot a 24px square hit area around its 8px visual dot", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    const dot = screen.getByRole("button", { name: "Volver a Estudiante" });
    expect(dot.className).toMatch(/\bh-6\b/);
    expect(dot.className).toMatch(/\bw-6\b/);
    expect(dot.className).not.toMatch(/\bh-2\b/);
    expect(dot.className).not.toMatch(/\bw-2\b/);

    // The 8px visual dot moves inside the 24px hit box, not lost.
    const visualDot = dot.querySelector("span");
    expect(visualDot).toHaveClass("h-2");
    expect(visualDot).toHaveClass("w-2");
    expect(visualDot).toHaveClass("bg-state-ok");
  });

  it("leaves the non-interactive dots at their original small size", () => {
    render(<Stepper steps={STEPS} current={2} label="Pasos" />);

    const dots = screen.getByTestId("stepper-compact").querySelectorAll("span[data-state]");
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of Array.from(dots)) {
      expect(dot.className).not.toMatch(/\bh-6\b/);
    }
  });
});

// #1332 (R3-002): ambos renders (píldoras anchas y puntos compactos) viven
// siempre en el DOM — solo CSS oculta uno con `sm:`. Un paso completado da
// dos botones con nombres accesibles distintos ("Estudiante" en la píldora,
// "Volver a Estudiante" en el punto); las pruebas de esta suite siempre
// afirman por nombre exacto o escopan explícitamente a un contenedor, nunca
// cuentan botones sin escopar. Este test documenta el patrón en vez de
// introducir un gate por `matchMedia`, que no aporta nada que el CSS ya no
// resuelva en el navegador real.
describe("Stepper — both renders coexist in the DOM (#1332 R3-002)", () => {
  function wideList(): HTMLElement {
    return screen.getByRole("list", { name: "Pasos" });
  }

  function compactRow(): HTMLElement {
    return screen.getByTestId("stepper-compact");
  }

  it("gives a completed step two buttons with distinct accessible names, one per container", () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={3} label="Pasos" onStepClick={onStepClick} />);

    // Tipo and Estudiante are done — two buttons in each container.
    expect(within(wideList()).getAllByRole("button")).toHaveLength(2);
    expect(within(compactRow()).getAllByRole("button")).toHaveLength(2);

    expect(within(wideList()).getByRole("button", { name: "Estudiante" })).toBeInTheDocument();
    expect(
      within(compactRow()).getByRole("button", { name: "Volver a Estudiante" }),
    ).toBeInTheDocument();
  });
});
