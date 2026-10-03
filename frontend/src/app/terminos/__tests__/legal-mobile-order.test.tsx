/**
 * VIS-07: on a phone the rails dissolve and the page is one column ordered by
 * the `order-*` utilities. "En resumen" used to sit before the document's
 * title, so a visitor read a summary without knowing which document it was
 * about. The title card comes first now.
 *
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TermsPage from "../page";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

/** The `order-N` utility a block carries (a block with none sorts as 0). */
function orderOf(element: Element | null): number {
  const match = element?.className.match(/(?:^|\s)order-(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : 0;
}

/** The nearest ancestor (or self) that takes part in the mobile ordering. */
function slotOf(element: Element): Element | null {
  let node: Element | null = element;
  while (node && orderOf(node) === 0) node = node.parentElement;
  return node;
}

function slots() {
  const title = slotOf(screen.getByRole("heading", { level: 1 }));
  const summary = slotOf(screen.getByRole("heading", { name: "En resumen" }));
  const article = slotOf(screen.getAllByRole("heading", { level: 2 }).find((h) => h.closest("article"))!);
  const version = slotOf(screen.getByRole("region", { name: "Versión y vigencia" }));
  return { title, summary, article, version };
}

describe("legal document — mobile reading order (VIS-07)", () => {
  it("reads title, then summary, then the article", () => {
    render(<TermsPage />);
    const { title, summary, article } = slots();

    expect(orderOf(title)).toBeGreaterThan(0);
    expect(orderOf(title)).toBeLessThan(orderOf(summary));
    expect(orderOf(summary)).toBeLessThan(orderOf(article));
  });

  it("keeps the reference cards after the article", () => {
    render(<TermsPage />);
    const { article, version } = slots();

    expect(orderOf(article)).toBeLessThanOrEqual(orderOf(version));
  });

  it("keeps the title and the article inside one card on desktop", () => {
    render(<TermsPage />);
    const wrapper = screen.getByRole("heading", { level: 1 }).closest("[class~='lg:card']");

    expect(wrapper).not.toBeNull();
    expect(wrapper).toContainElement(screen.getByRole("article"));
  });
});
