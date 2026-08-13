/**
 * `/ayuda` — regression for DSH-3: the screen used to render "Volver al
 * inicio" twice (a `BackLink` up top, a hand-styled `<Link>` at the bottom),
 * each with different visual treatment. One is enough.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import AyudaPage from "@/app/ayuda/page";
import { FAQ_SECTIONS } from "@/app/ayuda/faq-content";

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("AyudaPage", () => {
  it("renders exactly one 'Volver al inicio' link, not one at each end (DSH-3)", () => {
    render(<AyudaPage />);

    expect(screen.getAllByText("Volver al inicio")).toHaveLength(1);
  });

  it("points that one link at the site root with the canonical back skin", () => {
    render(<AyudaPage />);

    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveClass("border-cata-red", "bg-transparent", "text-cata-red-dark");
  });
});

// ---------------------------------------------------------------------------
// #203 — the FAQ grid collapses to one column and never fragments a section
// ---------------------------------------------------------------------------

describe("AyudaPage — FAQ grid (#203)", () => {
  it("lays the FAQ sections out two-up on desktop and one-up on narrow screens", () => {
    render(<AyudaPage />);
    const grid = screen.getByTestId("faq-grid");

    expect(grid).toHaveClass("grid-cols-1");
    expect(grid).toHaveClass("lg:grid-cols-2");
  });

  it("keeps every section, and all of its questions, inside one grid cell", () => {
    render(<AyudaPage />);
    const grid = screen.getByTestId("faq-grid");
    const sections = Array.from(grid.querySelectorAll(":scope > section"));

    expect(sections).toHaveLength(FAQ_SECTIONS.length);
    FAQ_SECTIONS.forEach((section, index) => {
      const cell = within(sections[index] as HTMLElement);
      expect(cell.getByRole("heading", { name: section.title })).toBeInTheDocument();
      for (const entry of section.entries) {
        expect(cell.getByRole("button", { name: entry.question })).toBeInTheDocument();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// #203 — each question is a compact accordion, collapsed by default
// ---------------------------------------------------------------------------

describe("AyudaPage — questions are accordions (#203)", () => {
  it("keeps every answer collapsed on first render", () => {
    render(<AyudaPage />);
    const entry = FAQ_SECTIONS[0].entries[0];

    const trigger = screen.getByRole("button", { name: entry.question });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // `getByText` finds the node even while `hidden` — it does not filter by
    // visibility the way a role query does — so the assertion that matters
    // here is that the node is not visible, i.e. actually hidden from a user.
    expect(screen.getByText(entry.answer)).not.toBeVisible();
  });

  it("reveals the answer once its question is opened", () => {
    render(<AyudaPage />);
    const entry = FAQ_SECTIONS[0].entries[0];
    const trigger = screen.getByRole("button", { name: entry.question });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(entry.answer)).toBeVisible();
  });

  it("allows at most one open question per section", () => {
    render(<AyudaPage />);
    const [first, second] = FAQ_SECTIONS[0].entries;
    const firstTrigger = screen.getByRole("button", { name: first.question });
    const secondTrigger = screen.getByRole("button", { name: second.question });

    fireEvent.click(firstTrigger);
    fireEvent.click(secondTrigger);

    expect(secondTrigger).toHaveAttribute("aria-expanded", "true");
    expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("still renders the schedule table in full, outside the accordion grid", () => {
    render(<AyudaPage />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Horarios de entrenamiento" })).toBeInTheDocument();
  });
});
