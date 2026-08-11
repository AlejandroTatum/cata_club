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
    // `text-xl` IS 26px: the scale step was transcribed from this component,
    // so the class changed name without the title changing size.
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-xl", "text-ink");
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

  /**
   * ASI-8: at 390px, `Generar PDF` painted over "Reportes" — the title read
   * "Repo" with the rest hidden under the button. `min-w-0` on the title
   * block let its layout BOX shrink toward zero once the actions competed
   * for space, but the `<h1>` text itself (`overflow: visible`, one
   * unbreakable word) kept painting at its real width past that shrunken
   * box — so the header's own `flex-wrap` never saw a reason to wrap, since
   * the (collapsed) boxes still fit on one line.
   *
   * The fix stacks title above actions by default, matching the
   * `flex-col ... sm:flex-row` convention `Pagination` already uses for the
   * same "narrow screen: never share a row" problem — actions only sit
   * beside the title once a `sm:` breakpoint gives them room.
   */
  it("stacks the title above actions by default, sharing a row only from sm: up (ASI-8)", () => {
    const { container } = render(
      <PageHeader title="Reportes" actions={<Button variant="primary">Generar PDF</Button>} />,
    );
    const header = container.firstElementChild as HTMLElement;
    expect(header).toHaveClass("flex-col");
    expect(header.className).toMatch(/\bsm:flex-row\b/);
  });
});
