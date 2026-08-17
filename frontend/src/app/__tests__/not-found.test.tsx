/**
 * The global 404 (issue #316 hallazgo #55).
 *
 * `GET /students` (or any unmatched route) used to fall straight through to
 * Next's own English placeholder — "404 | This page could not be found.",
 * `document.title` "404: This page could not be found." — inside an app that
 * is otherwise entirely Spanish. There was no file here before this change;
 * this suite is the first coverage `app/not-found.tsx` has ever had.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound, { metadata } from "@/app/not-found";
import type { UserRole } from "@/types/domain";

let mockRole: UserRole | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: mockRole
      ? { user: { id: "u1", name: "Test", email: "t@cataclub.com", role: mockRole, representanteId: null } }
      : null,
    isAuthenticated: mockRole !== null,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
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

describe("the global 404", () => {
  it("names itself in Spanish, not with Next's own English default", () => {
    // `title.absolute` is what `document.title` resolves to — never composed
    // through the root layout's "%s | Cata Club Admin" template, so this is
    // the whole answer, not half of it.
    expect(metadata.title).toEqual({ absolute: "Página no encontrada — Cata Club" });
  });

  it("renders a Spanish explanation instead of Next's raw placeholder", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: /no encontramos esta página/i })).toBeInTheDocument();
    expect(screen.queryByText(/this page could not be found/i)).not.toBeInTheDocument();
  });

  it("offers a real way back for a signed-in role, not a dead end", () => {
    mockRole = "admin";
    render(<NotFound />);

    // `backHrefForRole("admin")` is `/dashboard` — the same helper `/ayuda`
    // reads for the same question, so the two screens cannot disagree about
    // where an admin's "back" goes.
    const back = screen.getByRole("link", { name: /volver al panel de control/i });
    expect(back).toHaveAttribute("href", "/dashboard");

    mockRole = null;
  });

  it("falls back to the public site when nobody is signed in", () => {
    mockRole = null;
    render(<NotFound />);

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back).toHaveAttribute("href", "/");
  });
});
