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
