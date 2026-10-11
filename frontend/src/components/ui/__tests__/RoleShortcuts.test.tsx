import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RoleShortcuts } from "@/components/ui";

const SHORTCUTS = [
  { href: "/student", title: "Mi cuenta", description: "Su resumen" },
  { href: "/student/payments", title: "Pagos", description: "Sus cuotas" },
];

describe("RoleShortcuts", () => {
  it("renders one tile per shortcut with href, title and description", () => {
    render(<RoleShortcuts shortcuts={SHORTCUTS} label="Atajos" />);

    const list = screen.getByRole("list", { name: "Atajos" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    const link = screen.getByRole("link", { name: /Pagos/ });
    expect(link).toHaveAttribute("href", "/student/payments");
    expect(link).toHaveTextContent("Sus cuotas");
  });

  it("renders nothing but an empty list when there are no shortcuts", () => {
    render(<RoleShortcuts shortcuts={[]} label="Atajos" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("RoleShortcuts — no clipped text (T14 RC14)", () => {
  it("is a single column by default on a phone and two from sm", () => {
    render(<RoleShortcuts shortcuts={SHORTCUTS} label="Atajos" />);
    const list = screen.getByRole("list", { name: "Atajos" });
    expect(list.className).toMatch(/\bgrid-cols-1\b/);
    expect(list.className).toMatch(/sm:grid-cols-2/);
  });

  it("stays one column when the caller sits in a narrow rail", () => {
    render(<RoleShortcuts shortcuts={SHORTCUTS} label="Atajos" columns={1} />);
    expect(screen.getByRole("list", { name: "Atajos" }).className).not.toMatch(/sm:grid-cols-2/);
  });

  it("lets a long title and description wrap inside the tile", () => {
    render(<RoleShortcuts shortcuts={SHORTCUTS} label="Atajos" />);
    const link = screen.getByRole("link", { name: /Pagos/ });
    expect(link.className).toMatch(/\bmin-w-0\b/);
    expect(screen.getByText("Pagos").className).toMatch(/break-words/);
    expect(screen.getByText("Sus cuotas").className).toMatch(/break-words/);
  });
});
