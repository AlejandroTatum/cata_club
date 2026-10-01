/**
 * The panel's whole reason for existing is that the ORDER cannot drift. Members
 * put the search above its chips, Payments put it below, and both were correct
 * by their own file. So the test that matters here is not "it renders": it is
 * that a caller writing the props in the wrong order still gets the right one.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilterGroup, FilterPanel } from "@/components/ui";

afterEach(cleanup);

function panelOf(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** Same string as `AttendanceFilters` used to hold on its own. */
const BASE_CLASSES = ["flex", "flex-col", "gap-4", "card", "p-[18px]"];

describe("FilterPanel", () => {
  it("renders search, then chips, then fields — whatever order the props came in", () => {
    render(
      <FilterPanel
        label="Filtros"
        fields={<button type="button">campo</button>}
        chips={<button type="button">chip</button>}
        search={<button type="button">busqueda</button>}
      />,
    );

    const order = screen
      .getAllByRole("button")
      .map((node) => node.textContent);

    expect(order).toEqual(["busqueda", "chip", "campo"]);
  });

  it("omits a slot that was not given instead of leaving a gap", () => {
    render(<FilterPanel label="Solo chips" chips={<span>chip</span>} />);

    expect(panelOf("Solo chips").children).toHaveLength(1);
  });

  it("caps the search width itself, so no caller re-decides it", () => {
    // Members wrote `max-w-xs`, Payments `max-w-[320px]` and Niveles
    // `max-w-sm` for the same field. The first two are the same 320px.
    render(<FilterPanel label="Filtros" search={<input aria-label="Buscar" />} />);

    const wrapper = screen.getByLabelText("Buscar").parentElement;
    expect(wrapper?.className).toContain("max-w-xs");
  });

  it("carries its own panel classes when the caller passes nothing", () => {
    render(<FilterPanel label="Filtros" />);

    for (const cls of BASE_CLASSES) {
      expect(panelOf("Filtros").className.split(" ")).toContain(cls);
    }
  });

  it("keeps its base classes when the caller names only one extra", () => {
    render(<FilterPanel label="Filtros" className="mb-6" />);

    const classes = panelOf("Filtros").className.split(" ");
    expect(classes).toContain("mb-6");
    for (const cls of BASE_CLASSES) {
      expect(classes).toContain(cls);
    }
  });

  it("owns no vertical margin — the page rhythm belongs to the shell's gap", () => {
    render(<FilterPanel label="Filtros" />);

    expect(panelOf("Filtros").className).not.toMatch(/\bm[btly]?-/);
  });
});

describe("FilterGroup", () => {
  it("captions its block in the panel's small-caps label", () => {
    render(<FilterGroup label="Rango de fechas">contenido</FilterGroup>);

    const caption = screen.getByText("Rango de fechas");
    expect(caption.className).toContain("uppercase");
    expect(caption.className).toContain("text-2xs");
  });
});

/**
 * The panel is a COLUMN by default, and that is right for a rail. It is wrong
 * for a full-width page: `/attendance` spent 254px of a 900px viewport on three
 * controls stacked in the left 320px, with the whole right half of the card
 * empty — a quarter of the screen to ask three questions. The trainer's history
 * drew the same component the same way, at a wider measure still, and was fixed
 * later (issue #375) — no caller has ever stood this panel in a rail. What the
 * default protects is the panel with a SINGLE slot, which a grid would pin to
 * one track with nothing beside it; see the note on `AXIS` in `FilterPanel.tsx`.
 *
 * So the axis becomes the caller's declaration, and only the axis: the slot
 * SEQUENCE — search, chips, fields — is unchanged in both, because "a
 * caller cannot express the wrong order" is the reason this component exists.
 */
describe("FilterPanel — the axis is the caller's, the order is not", () => {
  it("stacks in a column by default, which is what a rail needs", () => {
    render(<FilterPanel label="Filtros" chips={<span>chip</span>} />);
    expect(panelOf("Filtros").className.split(" ")).toContain("flex-col");
  });

  it("flows the control slots across the width when asked to", () => {
    render(<FilterPanel label="Filtros" layout="row" chips={<span>chip</span>} />);
    const classes = panelOf("Filtros").className.split(" ");
    expect(classes).not.toContain("flex-col");
    expect(classes).toContain("grid");
  });

  it("keeps the slot order identical on both axes", () => {
    render(
      <FilterPanel
        label="Filtros"
        layout="row"
        fields={<button type="button">campo</button>}
        chips={<button type="button">chip</button>}
        search={<button type="button">busqueda</button>}
      />,
    );

    const order = screen.getAllByRole("button").map((node) => node.textContent);
    expect(order).toEqual(["busqueda", "chip", "campo"]);
  });

  it("still owns no vertical margin when flowing", () => {
    render(<FilterPanel label="Filtros" layout="row" />);
    expect(panelOf("Filtros").className).not.toMatch(/\bm[btly]?-/);
  });
});
