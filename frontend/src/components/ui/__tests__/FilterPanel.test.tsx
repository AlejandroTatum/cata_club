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

/**
 * D11c — "la ayuda no vive suelta". `/members` shipped its "Ver ayuda"
 * disclosure as a bare child of the canvas, in a band of its own between the
 * filters and the table, held there by an `mt-3` nobody else in the column
 * speaks. The note it opens is a caveat about what the search can reach ("this
 * listing may include up to 200 records"), so the block it belongs to is the
 * one that searches.
 *
 * It is the LAST slot on purpose: a caveat is read after the controls it
 * qualifies, and the panel's whole reason for existing is that a caller cannot
 * express the wrong order.
 */
describe("FilterPanel — the help slot (D11c)", () => {
  it("renders the help after the search, the chips and the fields", () => {
    render(
      <FilterPanel
        label="Filtros"
        help={<button type="button">ayuda</button>}
        fields={<button type="button">campo</button>}
        chips={<button type="button">chip</button>}
        search={<button type="button">busqueda</button>}
      />,
    );

    const order = screen.getAllByRole("button").map((node) => node.textContent);
    expect(order).toEqual(["busqueda", "chip", "campo", "ayuda"]);
  });

  it("omits the slot entirely when no help was given", () => {
    render(<FilterPanel label="Sin ayuda" chips={<span>chip</span>} />);
    expect(panelOf("Sin ayuda").children).toHaveLength(1);
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
 * draws the same component in the left third of its layout, where stacking is
 * the only thing that fits.
 *
 * So the axis becomes the caller's declaration, and only the axis: the slot
 * SEQUENCE — search, chips, fields, help — is unchanged in both, because "a
 * caller cannot express the wrong order" is the reason this component exists.
 * The help stays on its own full-width line even when flowing, since a caveat
 * is read after the controls it qualifies rather than beside them.
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
        help={<button type="button">ayuda</button>}
        fields={<button type="button">campo</button>}
        chips={<button type="button">chip</button>}
        search={<button type="button">busqueda</button>}
      />,
    );

    const order = screen.getAllByRole("button").map((node) => node.textContent);
    expect(order).toEqual(["busqueda", "chip", "campo", "ayuda"]);
  });

  it("still owns no vertical margin when flowing", () => {
    render(<FilterPanel label="Filtros" layout="row" />);
    expect(panelOf("Filtros").className).not.toMatch(/\bm[btly]?-/);
  });
});
