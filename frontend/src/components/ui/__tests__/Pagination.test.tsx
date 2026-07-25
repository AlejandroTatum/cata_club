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
