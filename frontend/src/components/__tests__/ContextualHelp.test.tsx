/**
 * ContextualHelp — the disclosure D11c puts every "cómo funciona" behind.
 *
 * The rule under test is about WHERE the component is allowed to place itself.
 * `docs/ux/ritmo-vertical.md` settles that: "Ninguna [regla de margen] separa
 * dos bloques de primer nivel. Todo el ritmo vertical del sistema está
 * expresado como `gap` sobre una columna." The component shipped with an
 * `mt-3` of its own, which is a fourth distance nobody declared — under the
 * shell's `gap-page` column it simply added 12px on top of the 20px step, and
 * inside a panel it fights that panel's gap.
 *
 * `FilterPanel` already proves the shape of this rule for a sibling primitive:
 * "owns no vertical margin — the page rhythm belongs to the shell's gap".
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ContextualHelp from "@/components/ContextualHelp";

/**
 * `defaultOpen` exists for exactly one situation: a state whose next step IS
 * the procedure the panel holds. Hiding it there is the defect the disclosure
 * was written to avoid, one click later — so `/student/payments` opens the
 * how-to-pay panel for a reader whose coverage lapsed or who never paid.
 *
 * Everywhere else the caller does not pass it, and the default has to stay
 * false: this component is the product's one "la ayuda no vive suelta" shape
 * (D11c) and six screens rely on the panel starting closed.
 */
describe("ContextualHelp — the panel starts closed unless the caller says otherwise", () => {
  it("keeps the panel closed when no caller asks for it — the D11c default", () => {
    render(
      <ContextualHelp title="Ayuda sobre límite de resultados">
        <p>Hasta 200 registros.</p>
      </ContextualHelp>,
    );

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ayuda sobre límite de resultados" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open, with the state announced, when the caller asks for it", () => {
    render(
      <ContextualHelp title="Cómo se registra un pago" defaultOpen>
        <p>Son tres pasos.</p>
      </ContextualHelp>,
    );

    const toggle = screen.getByRole("button", { name: "Cómo se registra un pago" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Cómo se registra un pago" })).toBeInTheDocument();
  });

  it("lets the reader close a panel that started open (triangulation)", () => {
    // `defaultOpen` seeds `useState`, it does not lock the panel: a reader who
    // has read the steps must be able to fold them away like any other help.
    render(
      <ContextualHelp title="Cómo se registra un pago" defaultOpen>
        <p>Son tres pasos.</p>
      </ContextualHelp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cómo se registra un pago" }));

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cómo se registra un pago" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

// Issue #818 (WCAG 2.5.8, AA): "Ver ayuda" measured 56 × 18.8px — bare 12px
// type with no padding or min-height, on every screen that renders it. jsdom
// cannot measure layout, so the lock is class-based: `MIN_TARGET_CLASS`
// (`min-h-[24px]`) is the project's shared floor for exactly this shape
// (`lib/target-size.ts`), paired with `inline-flex items-center` so the extra
// space is shared above and below the label instead of pushing it down.
describe("ContextualHelp — the trigger clears the 24px target-size floor", () => {
  it("gives the toggle a 24px minimum hit area without resizing its type", () => {
    render(
      <ContextualHelp title="Ayuda sobre límite de resultados">
        <p>Hasta 200 registros.</p>
      </ContextualHelp>,
    );

    const toggle = screen.getByRole("button", { name: "Ayuda sobre límite de resultados" });
    expect(toggle).toHaveClass("min-h-[24px]");
    expect(toggle).toHaveClass("inline-flex");
    expect(toggle).toHaveClass("items-center");
    expect(toggle.className).toMatch(/\btext-xs\b/);
  });
});

describe("ContextualHelp — the container owns the rhythm", () => {
  it("carries no vertical margin of its own", () => {
    const { container } = render(
      <ContextualHelp title="Ayuda sobre límite de resultados">
        <p>Hasta 200 registros.</p>
      </ContextualHelp>,
    );

    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\bm[btly]?-/);
  });

  it("still opens and closes its panel", () => {
    render(
      <ContextualHelp title="Ayuda sobre límite de resultados">
        <p>Hasta 200 registros.</p>
      </ContextualHelp>,
    );

    const toggle = screen.getByRole("button", { name: "Ayuda sobre límite de resultados" });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "Ayuda sobre límite de resultados" })).toBeInTheDocument();
  });

  /**
   * The open panel is a SUNKEN AREA INSIDE the block that opened it, so it
   * takes the sunken surface and the control radius — the two the system has
   * for exactly that. It shipped as `rounded-lg` (8px, a radius DESIGN.md does
   * not declare) filled with the legacy `cata-bg`/`cata-border` pair, which is
   * the pre-redesign palette the foundation replaced. Seven screens open this
   * panel, so the drift was seven screens wide.
   */
  it("opens onto the system's sunken surface at the control radius", () => {
    render(
      <ContextualHelp title="Ayuda sobre límite de resultados">
        <p>Hasta 200 registros.</p>
      </ContextualHelp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ayuda sobre límite de resultados" }));
    const panel = screen.getByRole("region", { name: "Ayuda sobre límite de resultados" });

    expect(panel).toHaveClass("rounded-ctl");
    expect(panel).toHaveClass("bg-sunken");
    expect(panel).toHaveClass("border-line");
    expect(panel.className).not.toMatch(/\bcata-(bg|border)\b/);
    expect(panel.className).not.toMatch(/\brounded-lg\b/);
  });
});
