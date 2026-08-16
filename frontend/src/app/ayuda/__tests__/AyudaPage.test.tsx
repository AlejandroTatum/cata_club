/**
 * `/ayuda` — regression for DSH-3: the screen used to render "Volver al
 * inicio" twice (a `BackLink` up top, a hand-styled `<Link>` at the bottom),
 * each with different visual treatment. One is enough.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import AyudaPage from "@/app/ayuda/page";
import { FAQ_SECTIONS } from "@/app/ayuda/faq-content";
import type { UserRole } from "@/types/domain";

/**
 * The screen is public, so signed out is its default state here — which is
 * also what keeps every pre-#295 assertion in this file reading "/".
 */
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

beforeEach(() => {
  mockRole = null;
});

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
  it("renders exactly one 'Volver al Inicio' link, not one at each end (DSH-3)", () => {
    render(<AyudaPage />);

    // The capital is the registry\'s: `/` is called "Inicio" wherever it is
    // named, and a back control never re-cases the destination (D12b).
    expect(screen.getAllByText("Volver al Inicio")).toHaveLength(1);
  });

  it("points that one link at the site root with the canonical back skin", () => {
    render(<AyudaPage />);

    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveAttribute("href", "/");
    // The canonical skin is the system\'s tertiary level now, not a red
    // outline: back is the least important control on the screen.
    expect(link).toHaveClass("bg-sunken", "border-transparent", "text-ink-2");
    expect(link.className).not.toMatch(/cata-red/);
  });
});

/**
 * The card titles wear the club's face, like every other screen on this shell.
 *
 * `/ayuda` came out of its own rework (commit eace106) aligned in structure —
 * one column, the same back control, 2% dead air — and still spelling its card
 * titles `text-base font-extrabold`, which is Barlow, the interface face. That
 * is what every screen in the panel looked like before the admin batch: the
 * `title` step is 20px Graduate, and the guard in
 * `lib/__tests__/display-face-usage.test.ts` only fires once the heading is AT
 * that step, so a title left one step below it passes by being too small
 * rather than by being right.
 *
 * The closing "¿No encontró lo que buscaba?" panel is deliberately not in this
 * set: it is a sunken inset, not a card, and its heading is a question put to
 * the reader rather than the name of a block. "Si dudás, es Barlow."
 */
describe("AyudaPage — the club's face on its card titles", () => {
  it("draws the schedule table's title at the title step, in Graduate", () => {
    render(<AyudaPage />);

    const heading = screen.getByRole("heading", { name: "Horarios de entrenamiento" });
    expect(heading.className).toMatch(/\bfont-display\b/);
    expect(heading.className).toMatch(/\btext-lg\b/);
    expect(heading.className).toMatch(/\btracking-flat\b/);
  });

  it("draws every audience section's title the same way", () => {
    render(<AyudaPage />);

    for (const section of FAQ_SECTIONS) {
      const heading = screen.getByRole("heading", { name: section.title });
      expect(heading.className).toMatch(/\bfont-display\b/);
      expect(heading.className).toMatch(/\btext-lg\b/);
    }
  });

  /**
   * Two radii and nothing else. The audience chips were `rounded-xl` — 12px,
   * a third radius with no step in `DESIGN.md` — which is the same drift the
   * admin batch pulled out of the discounts form and the help panel.
   */
  it("keeps the audience chips on one of the system's two radii", () => {
    const { container } = render(<AyudaPage />);

    expect(container.querySelectorAll(".rounded-xl")).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// "Volver" from a screen reachable from everywhere (#295)
//
// /ayuda is public, but it is linked from the authenticated sidebar
// ("Preguntas frecuentes"), from the chat widget and from /student. A fixed
// "/" therefore ejected a signed-in admin out of the panel and onto the
// public landing — the way out of the product, offered as the way back.
// ---------------------------------------------------------------------------

describe("AyudaPage — the way back follows who is asking (#295)", () => {
  it("sends a signed-out visitor to the public site", () => {
    render(<AyudaPage />);

    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/");
  });

  it("sends an administrator back into the panel, not out of it", () => {
    mockRole = "admin";
    render(<AyudaPage />);

    const back = screen.getByRole("link", { name: /^volver/i });
    expect(back).toHaveAttribute("href", "/dashboard");
    expect(back).toHaveTextContent("Volver al Panel de Control");
  });

  it("sends a trainer to their own day", () => {
    mockRole = "trainer";
    render(<AyudaPage />);

    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/trainer");
  });

  it("sends a student and a representante to their account", () => {
    mockRole = "estudiante";
    const { unmount } = render(<AyudaPage />);
    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/student");
    unmount();

    mockRole = "representante";
    render(<AyudaPage />);
    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/student");
  });

  it("falls back to the public site for a role with no home to return to", () => {
    // `getDefaultRoute("unsupported")` is /unauthorized — not a place anyone
    // goes BACK to, and not a name the destination registry carries, so
    // BackLink would throw on it rather than render.
    mockRole = "unsupported";
    render(<AyudaPage />);

    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/");
  });

  it("still offers exactly one back control (DSH-3 stays settled)", () => {
    mockRole = "admin";
    render(<AyudaPage />);

    expect(screen.getAllByRole("link", { name: /^volver/i })).toHaveLength(1);
  });
});
