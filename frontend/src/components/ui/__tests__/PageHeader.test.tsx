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

  /**
   * DESIGN.md's `headline` step is Graduate at 26px, and this is the component
   * that owns every page title in the product. The foundation loaded the three
   * families and made Barlow the default `sans`, so all interface text changed
   * on its own — but `display` is a utility that has to be ASKED for, and for a
   * while nobody asked: this `<h1>` was `text-xl font-extrabold`, which resolves
   * to Barlow. The product contradicted its own design system in the one place
   * that names each screen.
   */
  it("sets the page title in the display family", () => {
    render(<PageHeader title="Membresías y Pagos" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("font-display");
  });

  it("uppercases the title through CSS, leaving the words themselves alone", () => {
    render(<PageHeader title="Membresías y Pagos" />);
    const heading = screen.getByRole("heading", { level: 1 });
    // Graduate has no lowercase design, so a headline in it is uppercase. The
    // CASE is a `text-transform`, never a rewritten string: the accessible name
    // a screen reader announces stays the sentence the screen was named with.
    expect(heading).toHaveClass("uppercase");
    expect(heading).toHaveTextContent("Membresías y Pagos");
  });

  it("cancels the tracking its size step carries, and asks for no weight it lacks", () => {
    render(<PageHeader title="Miembros" />);
    const heading = screen.getByRole("heading", { level: 1 });
    // `text-xl` ships -0.03em, calibrated for Barlow's lowercase at 26px.
    // Uppercase Graduate is wide and flat and needs its sidebearings back, so
    // the heading takes the declared step that contradicts its size —
    // `tracking-flat` (`tailwind.config.ts`) — rather than a loose value.
    expect(heading).toHaveClass("tracking-flat");
    // Graduate ships ONE weight (`lib/fonts.ts`). A bold utility here does not
    // reach a bolder cut, it asks the browser to synthesise one.
    expect(heading.className).not.toMatch(/\bfont-(semibold|bold|extrabold|black)\b/);
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
