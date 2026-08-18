/**
 * Pagination — the one pager.
 *
 * The behaviour worth pinning is the range readout, because that is the thing
 * none of the six replaced paginators had: an admin reconciling a list against
 * a total should never have to multiply a page number by a page size nobody
 * told them.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Pagination from "../Pagination";

describe("Pagination", () => {
  it("renders the page count as its own exact text node", () => {
    render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />);
    // Exact match: the readout must not be welded into one string, or every
    // existing `getByText("Página 1 de 3")` across the suite breaks.
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("renders the range readout when totals are supplied", () => {
    render(
      <Pagination
        page={2}
        totalPages={14}
        onPageChange={vi.fn()}
        totalItems={137}
        pageSize={10}
      />,
    );
    expect(screen.getByText(/11–20 de 137/)).toBeInTheDocument();
  });

  it("clamps the last page's range to the real total", () => {
    render(
      <Pagination
        page={14}
        totalPages={14}
        onPageChange={vi.fn()}
        totalItems={137}
        pageSize={10}
      />,
    );
    // 14 * 10 = 140, but there are only 137 rows.
    expect(screen.getByText(/131–137 de 137/)).toBeInTheDocument();
  });

  it("pluralises the item noun, and does not pluralise a single item", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        totalPages={1}
        onPageChange={vi.fn()}
        totalItems={5}
        pageSize={10}
        itemNoun="registro"
      />,
    );
    expect(screen.getByText(/1–5 de 5 registros/)).toBeInTheDocument();

    rerender(
      <Pagination
        page={1}
        totalPages={1}
        onPageChange={vi.fn()}
        totalItems={1}
        pageSize={10}
        itemNoun="registro"
      />,
    );
    expect(screen.getByText(/1–1 de 1 registro$/)).toBeInTheDocument();
  });

  it("omits the range rather than rendering '0–0 de 0'", () => {
    render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} totalItems={0} pageSize={10} />,
    );
    expect(screen.queryByText(/de 0/)).not.toBeInTheDocument();
  });

  it("keeps visible Anterior/Siguiente text, not icon-only controls", () => {
    render(<Pagination page={2} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toHaveTextContent("Anterior");
    expect(screen.getByRole("button", { name: "Página siguiente" })).toHaveTextContent("Siguiente");
  });

  it("emits the resolved page number, not an updater function", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={3} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables the edges so a click can never walk off the range", () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();

    rerender(<Pagination page={3} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });

  it("renders the 32px in-table control height, not a caller-invented one", () => {
    render(<Pagination page={1} totalPages={2} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toHaveClass("h-ctl-sm");
  });
});

/**
 * Five callers each hand-wrote a container to weld the pager to the bottom of
 * its card, and no two agreed: `px-4 py-3` twice, `px-5 py-4`, `px-5 py-3.5`
 * with a fill, and one that drew a whole rounded box. Two more callers wrote
 * nothing, so their pager floated OUTSIDE the card while every other screen's
 * sat soldered to the foot of it.
 *
 * That is a missing variant, not a missing `className`: the component knew
 * about exactly one of the two places a pager lives.
 */
describe("Pagination — where it sits", () => {
  it("floats free by default, with its own separation from the block above", () => {
    const { container } = render(<Pagination page={1} totalPages={2} onPageChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass("mt-4");
    expect(root.className).not.toContain("border-t");
  });

  it("welds to the foot of a card in the footer variant, with no margin of its own", () => {
    const { container } = render(
      <Pagination page={1} totalPages={2} onPageChange={vi.fn()} variant="footer" />,
    );
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass("border-t", "border-line");
    // A margin here would push the pager off the card edge it is welded to,
    // which is what every caller was cancelling with `mt-0`.
    expect(root.className).not.toMatch(/\bmt-/);
  });

  it("takes the table's own gutter, so the pager lines up with the cells above it", () => {
    // `TableCell` is `px-4`. A pager at `px-5` sits one step outside the column
    // it belongs to — two of the five hand-written containers did exactly that.
    const { container } = render(
      <Pagination page={1} totalPages={2} onPageChange={vi.fn()} variant="footer" />,
    );

    expect(container.firstElementChild).toHaveClass("px-4", "py-3");
  });

  it("leaves no caller writing its own position", () => {
    // The acceptance criterion, asserted on the sources. `className` stays for
    // what it is for — a caller adding something the variant does not cover —
    // but placement is the component's job now.
    const screens = [
      "src/app/attendance/page.tsx",
      "src/app/payments/page.tsx",
      "src/app/reports/page.tsx",
      "src/app/members/page.tsx",
      "src/app/groups/page.tsx",
      // El asistente del entrenador también paginaba su nómina; se borró
      // mientras se rehace dentro de Miembros, y su renglón se fue con él.
      "src/app/trainer/attendance/history/page.tsx",
    ];

    for (const path of screens) {
      const code = readFileSync(join(__dirname, "..", "..", "..", "..", path), "utf8");
      const call = /<Pagination\b[\s\S]*?\/>/g;
      for (const [markup] of code.matchAll(call)) {
        expect(markup, path).not.toMatch(/className=[^\n]*\b(mt-|border-t|px-|py-)/);
      }
    }
  });
});
