/**
 * `/ayuda` — regression for DSH-3: the screen used to render "Volver al
 * inicio" twice (a `BackLink` up top, a hand-styled `<Link>` at the bottom),
 * each with different visual treatment. One is enough.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AyudaPage from "@/app/ayuda/page";

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
});
