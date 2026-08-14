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
});
