/**
 * Table primitives — 44px headers and 60px rows, the two metrics `.tbl`
 * commits to.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui/Table";
import { committedHeight } from "./ui-test-utils";

function renderTable() {
  return render(
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Responsable de pago</TableHeaderCell>
          <TableHeaderCell>Contacto</TableHeaderCell>
          <TableHeaderCell align="right">Acciones</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableNameCell name="Laura Vera" sub="Representante" />
          <TableCell>0981 000 010</TableCell>
          <TableCell align="right">Editar</TableCell>
        </TableRow>
        <TableRow>
          <TableNameCell name="Ana Garcia" />
          <TableCell>0971 111 111</TableCell>
          <TableCell align="right">Editar</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table — committed dimensions", () => {
  it("renders header cells at 44px", () => {
    renderTable();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(committedHeight(header)).toBe("44px");
    }
  });

  it("renders body cells at 60px", () => {
    renderTable();
    for (const cell of screen.getAllByRole("cell")) {
      expect(committedHeight(cell)).toBe("60px");
    }
  });
});

describe("Table — structure", () => {
  it("renders a real table with a header and body", () => {
    renderTable();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("scopes header cells to their column", () => {
    renderTable();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("drops the divider under the last row so the card edge stays clean", () => {
    renderTable();
    expect(screen.getByRole("table")).toHaveClass("[&_tbody_tr:last-child_td]:border-b-0");
  });

  it("right-aligns the action column on request", () => {
    renderTable();
    const [, , actionHeader] = screen.getAllByRole("columnheader");
    expect(actionHeader).toHaveClass("text-right");
  });
});

describe("TableNameCell", () => {
  it("renders the name in ink over an optional muted subtitle", () => {
    renderTable();
    expect(screen.getByText("Laura Vera")).toHaveClass("text-ink", "font-semibold");
    expect(screen.getByText("Representante")).toHaveClass("text-ink-3");
  });

  it("omits the subtitle line when there is none", () => {
    renderTable();
    const cell = screen.getByText("Ana Garcia").closest("td") as HTMLElement;
    expect(cell.querySelectorAll("span")).toHaveLength(1);
  });

  it("keeps the 60px row height", () => {
    renderTable();
    expect(committedHeight(screen.getByText("Laura Vera").closest("td") as HTMLElement)).toBe(
      "60px",
    );
  });
});

/**
 * `TableRow` took `className` and `children` and nothing else, so a screen that
 * needed to mark a row — state, a test hook, an id — could not migrate to the
 * primitive without losing it. Descuentos was exactly that case: its rows carry
 * `data-inactivo`, which is what its own tests read to tell a disabled discount
 * from an active one. A primitive that drops attributes is a primitive screens
 * work around instead of adopting, which is how three lists ended up hand-built.
 */
describe("TableRow — what it forwards", () => {
  it("forwards data attributes, so a row can carry its own state", () => {
    render(
      <table>
        <tbody>
          <TableRow data-inactivo="true">
            <TableCell>Convenio empresa</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );

    const row = screen.getByText("Convenio empresa").closest("tr") as HTMLElement;
    expect(row).toHaveAttribute("data-inactivo", "true");
  });

  it("still merges className rather than replacing anything", () => {
    render(
      <table>
        <tbody>
          <TableRow className="opacity-60">
            <TableCell>Inactivo</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );

    expect(screen.getByText("Inactivo").closest("tr")).toHaveClass("opacity-60");
  });

  it("forwards a row-level handler, which a clickable row needs", () => {
    const onClick = vi.fn();
    render(
      <table>
        <tbody>
          <TableRow onClick={onClick}>
            <TableCell>Fila</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByText("Fila").closest("tr") as HTMLElement);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
