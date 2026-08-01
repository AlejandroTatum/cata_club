/**
 * PageHeader — the fix for the audit's P1: `AppShell` renders its `<h1>` as
 * `sr-only`, so no authenticated screen shows its own name. The title here is
 * a real, visible `<h1>`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";

describe("PageHeader — the title", () => {
  it("renders the page name as a level-1 heading", () => {
    render(<PageHeader title="Miembros" />);
    expect(screen.getByRole("heading", { level: 1, name: "Miembros" })).toBeInTheDocument();
  });

  it("renders that heading visibly, not screen-reader-only", () => {
    render(<PageHeader title="Miembros" />);
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveClass("sr-only");
  });

  it("gives the title the 26px page-title treatment", () => {
    render(<PageHeader title="Miembros" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-[26px]", "text-ink");
  });
});

describe("PageHeader — optional parts", () => {
  it("renders no eyebrow element above the title", () => {
    render(<PageHeader title="Miembros" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Miembros" });
    expect(heading.parentElement?.firstElementChild).toBe(heading);
  });

  it("renders the subtitle", () => {
    render(
      <PageHeader
        title="Reportes"
        subtitle="Genera y descarga los documentos del club."
      />,
    );
    expect(
      screen.getByText("Genera y descarga los documentos del club."),
    ).toBeInTheDocument();
  });

  it("omits the subtitle when not supplied", () => {
    const { container } = render(<PageHeader title="Panel" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders trailing actions alongside the title", () => {
    render(
      <PageHeader
        title="Miembros"
        actions={<Button variant="dark">+ Nuevo miembro</Button>}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Nuevo miembro" })).toBeInTheDocument();
  });
});

describe("PageHeader — structure", () => {
  it("is a <header> landmark so the shell can style it uniformly", () => {
    const { container } = render(<PageHeader title="Panel" />);
    expect(container.firstElementChild?.tagName).toBe("HEADER");
  });

  it("lets the title block take the free space so actions sit at the end", () => {
    render(<PageHeader title="Panel" />);
    const block = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(block).toHaveClass("flex-1", "min-w-0");
  });
});
