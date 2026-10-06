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
import { fetchClubPaymentInfo } from "@/services/api";
import { FAQ_SECTIONS, faqSectionsFor } from "@/app/ayuda/faq-content";
import { PAGE_RAIL } from "@/components/ui";
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

vi.mock("@/services/api", () => ({ fetchClubPaymentInfo: vi.fn() }));

beforeEach(() => {
  mockRole = null;
  vi.mocked(fetchClubPaymentInfo).mockReset().mockResolvedValue({ holder: "Titular Prueba", accountType: "Cuenta de Ahorros", accountNumber: "1234567890", bank: "Banco Prueba", holderId: "0102030405" });
});

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  /*
   * Faithful to the real shell's document order (#1396): the shell draws the
   * page's `back` control FIRST, then the visible `<h1>` title (`PageHeader`),
   * then the page's children. Transcribing that order here — rather than a
   * bare `{children}` passthrough — is what makes the placement test below a
   * real regression guard: if the page ever moved its BackLink back among its
   * children, the link would land after the title and the test would fail.
   */
  default: ({
    back,
    children,
    title,
  }: {
    back?: React.ReactNode;
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="app-shell">
      {back}
      <h1>{title}</h1>
      {children}
    </div>
  ),
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

// VIS-05: the management shell (dark sidebar, panel title) is for people who
// are signed in. `/ayuda` is public, so a visitor gets a plain page instead.
describe("AyudaPage — the shell follows the session (VIS-05)", () => {
  it("renders no management shell for a visitor without a session", () => {
    render(<AyudaPage />);

    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Preguntas frecuentes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver al inicio/i })).toHaveAttribute("href", "/");
    // The content is the same: the page is not a cut-down version.
    expect(screen.getByRole("heading", { name: "Para empezar" })).toBeInTheDocument();
  });

  it("keeps the management shell for a signed-in user", () => {
    mockRole = "admin";

    render(<AyudaPage />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });
});

describe("AyudaPage — «Cómo pagar» (FAM-04)", () => {
  it("shows a visitor only a sign-in notice, never the data, and does not request it", () => {
    render(<AyudaPage />);

    const notice = screen.getByTestId("how-to-pay-signin");
    expect(notice).toHaveTextContent("Los datos para transferencia se muestran al iniciar sesión.");
    expect(within(notice).getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/login?next=/ayuda");
    expect(screen.queryByTestId("how-to-pay")).toBeNull();
    expect(document.body).not.toHaveTextContent("1234567890");
    expect(fetchClubPaymentInfo).not.toHaveBeenCalled();
  });

  it("shows the club's transfer data to a signed-in user", async () => {
    mockRole = "estudiante";
    render(<AyudaPage />);

    const block = await screen.findByTestId("how-to-pay");
    expect(block).toHaveTextContent("Banco Prueba");
    expect(block).toHaveTextContent("1234567890");
    expect(screen.queryByTestId("how-to-pay-signin")).toBeNull();
  });
});

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
  it("draws every audience section's title the same way", () => {
    const seen = new Set<string>();
    for (const role of [null, "estudiante", "trainer", "admin"] as const) {
      mockRole = role;
      const { unmount } = render(<AyudaPage />);
      for (const section of faqSectionsFor(role ?? undefined)) {
        const heading = screen.getByRole("heading", { name: section.title });
        expect(heading.className).toMatch(/\bfont-display\b/);
        expect(heading.className).toMatch(/\btext-lg\b/);
        seen.add(section.title);
      }
      unmount();
    }
    expect([...seen].sort()).toEqual(FAQ_SECTIONS.map((section) => section.title).sort());
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
  it("flows the FAQ sections in balanced columns: one on narrow screens, two on desktop (#1660)", () => {
    render(<AyudaPage />);
    const grid = screen.getByTestId("faq-grid");

    expect(grid).toHaveClass("columns-1");
    expect(grid).toHaveClass("xl:columns-2");
    // A row-based grid leaves a dead band under the short card.
    expect(grid.className).not.toMatch(/\bgrid\b/);
  });

  it("keeps each section card whole and sized to its own content (#1618, #1660)", () => {
    render(<AyudaPage />);
    const grid = screen.getByTestId("faq-grid");

    expect(grid.className).not.toMatch(/auto-rows-fr/);
    expect(grid.className).not.toMatch(/min-h-/);
    for (const section of Array.from(grid.querySelectorAll(":scope > section"))) {
      expect(section).toHaveClass("break-inside-avoid");
    }
  });

  it("keeps every section, and all of its questions, inside one grid cell", () => {
    mockRole = "estudiante";
    render(<AyudaPage />);
    const grid = screen.getByTestId("faq-grid");
    const sections = Array.from(grid.querySelectorAll(":scope > section"));
    const visible = faqSectionsFor("estudiante");

    expect(sections).toHaveLength(visible.length);
    visible.forEach((section, index) => {
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

// ---------------------------------------------------------------------------
// #1396 — the way back sits ABOVE the page title, not below it
// ---------------------------------------------------------------------------

describe("AyudaPage — the way back sits above the page title (#1396)", () => {
  /**
   * Placement is a document-order guarantee, not a CSS one: the back control
   * has to PRECEDE the page title in the DOM, so the tab order and a screen
   * reader's read-out meet "back" before the screen's own name. The shell's
   * slot (`AppShell.back`) is what puts it there — this holds the page to
   * using that slot instead of drawing the control among its children, which
   * lands after the title by construction.
   */
  it("offers the back control before the h1 in the document", () => {
    render(<AyudaPage />);

    const back = screen.getByRole("link", { name: /^volver/i });
    const title = screen.getByRole("heading", { name: "Preguntas frecuentes", level: 1 });
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #1374 correction — /ayuda is the FAQ, whole. The schedule answer directs to
// the landing's live section; nothing on this page restates volatile facts.
// ---------------------------------------------------------------------------

describe("AyudaPage — the FAQ is the whole surface (#1374 correction)", () => {
  it("renders no schedule table, club facts, or leftover informational blocks", () => {
    const { container } = render(<AyudaPage />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="club-fact"]')).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "El club" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No encontró lo que buscaba/i)).not.toBeInTheDocument();
  });

  it("directs the horarios answer to the landing's live section with a working link", () => {
    render(<AyudaPage />);

    const trigger = screen.getByRole("button", { name: "¿Cuáles son los horarios?" });
    fireEvent.click(trigger);

    const link = screen.getByRole("link", { name: "Horarios de la página principal" });
    expect(link).toHaveAttribute("href", "/#horarios");
    expect(link).toBeVisible();
  });

  it("never restates a schedule, price, or other unverifiable figure in an answer", () => {
    render(<AyudaPage />);

    // The landing owns the volatile facts. Any HH:MM or money figure showing
    // up in an answer panel means static copy snuck back in.
    const answers = FAQ_SECTIONS.flatMap((section) =>
      section.entries.map((entry) => entry.answer),
    ).join(" ");

    expect(answers).not.toMatch(/\d{1,2}:\d{2}/);
    expect(answers).not.toMatch(/\$\s?\d|USD\s?\d/);
  });

  it("points every rendered answer link at the landing's schedule anchor", () => {
    const { container } = render(<AyudaPage />);

    // The only in-answer navigation is the one hop to the live schedules. A
    // second link pattern here needs its own guard, not this one's silence.
    const links = Array.from(container.querySelectorAll('[data-testid="faq-grid"] a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/#horarios");
    }
  });
});

// ---------------------------------------------------------------------------
// admin v4 — search, categories and a rail that always carries the guidance
// ---------------------------------------------------------------------------

describe("AyudaPage — search, categories and rail (admin v4)", () => {
  it("splits the page with PAGE_RAIL: the FAQ on the left, the guidance rail on the right", () => {
    render(<AyudaPage />);
    const split = screen.getByTestId("faq-split");

    expect(split.className).toBe(PAGE_RAIL);
    expect(within(split.children[0] as HTMLElement).getByTestId("faq-grid")).toBeInTheDocument();
    const rail = within(split.children[1] as HTMLElement);
    expect(rail.getByRole("heading", { name: "Cómo usar esta página" })).toBeVisible();
    expect(rail.getByRole("heading", { name: "¿No encontraste tu respuesta?" })).toBeVisible();
    expect(rail.getByRole("button", { name: "Reportar un problema" })).toBeInTheDocument();
  });

  it("narrows the sections to the typed question, ignoring case and accents", () => {
    render(<AyudaPage />);
    const entry = FAQ_SECTIONS[0].entries[0];
    const needle = entry.question.slice(1, 12).toUpperCase();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar una pregunta" }), {
      target: { value: needle },
    });

    expect(screen.getByRole("button", { name: entry.question })).toBeInTheDocument();
    const total = faqSectionsFor(undefined).reduce((n, section) => n + section.entries.length, 0);
    const shown = within(screen.getByTestId("faq-grid")).getAllByRole("button").length;
    expect(shown).toBeLessThan(total);
  });

  it("shows an empty state when nothing matches", () => {
    render(<AyudaPage />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar una pregunta" }), {
      target: { value: "zzzxqj" },
    });

    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
    expect(screen.queryByTestId("faq-grid")?.children).toHaveLength(0);
  });

  it("filters to one category and returns to all of them", () => {
    mockRole = "estudiante";
    render(<AyudaPage />);
    const only = faqSectionsFor("estudiante")[1];

    fireEvent.click(screen.getByRole("button", { name: only.title, pressed: false }));
    const grid = screen.getByTestId("faq-grid");
    expect(grid.querySelectorAll(":scope > section")).toHaveLength(1);
    expect(within(grid).getByRole("heading", { name: only.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(screen.getByTestId("faq-grid").querySelectorAll(":scope > section")).toHaveLength(
      faqSectionsFor("estudiante").length,
    );
  });

  it("offers quick links by role as shortcut tiles", () => {
    mockRole = "admin";
    const { unmount } = render(<AyudaPage />);
    const adminTiles = within(screen.getByRole("list", { name: "Accesos rápidos" }));
    expect(adminTiles.getByRole("link", { name: /Miembros/ })).toHaveAttribute("href", "/members");
    expect(adminTiles.getByRole("link", { name: /Miembros/ })).toHaveTextContent("Cuentas, roles y membresías");
    unmount();

    mockRole = "estudiante";
    const second = render(<AyudaPage />);
    expect(screen.getByRole("link", { name: /Mis pagos/ })).toHaveAttribute("href", "/student/payments");
    second.unmount();

    mockRole = "representante";
    render(<AyudaPage />);
    expect(screen.getByRole("link", { name: /Agregar jugador/ })).toHaveAttribute(
      "href",
      "/student/add-dependent",
    );
  });

  it("offers sign-in and the public site to a signed-out visitor", () => {
    render(<AyudaPage />);

    // The quick-links rail and the «Cómo pagar» notice both offer sign-in.
    const hrefs = screen.getAllByRole("link", { name: /Iniciar sesión/ }).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/login");
  });
});

// ---------------------------------------------------------------------------
// #1581 — each person sees only the questions of their own role
// ---------------------------------------------------------------------------

const PARA_EMPEZAR = "Para empezar";
const FAMILIA = "Si eres jugador o representante";
const ENTRENADOR = "Si eres entrenador";
const ADMINISTRADOR = "Si eres administrador";
const ALL_TITLES = [PARA_EMPEZAR, FAMILIA, ENTRENADOR, ADMINISTRADOR];

function renderedSectionTitles(): string[] {
  return within(screen.getByTestId("faq-grid"))
    .queryAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

function categoryChips(): string[] {
  return within(screen.getByRole("group", { name: "Filtrar por categoría" }))
    .getAllByRole("button")
    .map((chip) => chip.textContent ?? "")
    .filter((label) => label !== "Todas");
}

describe("AyudaPage — the FAQ is filtered by role (#1581)", () => {
  it.each<[string, UserRole | null, string[]]>([
    ["a visitor", null, [PARA_EMPEZAR]],
    ["a player", "estudiante", [PARA_EMPEZAR, FAMILIA]],
    ["a representante", "representante", [PARA_EMPEZAR, FAMILIA]],
    ["a trainer", "trainer", [PARA_EMPEZAR, ENTRENADOR]],
    ["an administrator", "admin", [PARA_EMPEZAR, ADMINISTRADOR]],
    ["a role with no home", "unsupported", [PARA_EMPEZAR]],
  ])("shows %s exactly their sections, in the chips too", (_who, role, expected) => {
    mockRole = role;
    render(<AyudaPage />);

    expect(renderedSectionTitles()).toEqual(expected);
    expect(categoryChips()).toEqual(expected);
    for (const hidden of ALL_TITLES.filter((title) => !expected.includes(title))) {
      expect(screen.queryByRole("heading", { name: hidden })).not.toBeInTheDocument();
    }
  });

  it("keeps the administration questions away from everyone but administrators", () => {
    const adminOnly = FAQ_SECTIONS.find((section) => section.title === ADMINISTRADOR)!.entries;
    expect(adminOnly.length).toBeGreaterThan(0);

    for (const role of [null, "estudiante", "representante", "trainer"] as const) {
      mockRole = role;
      const { unmount } = render(<AyudaPage />);
      for (const entry of adminOnly) {
        expect(screen.queryByRole("button", { name: entry.question })).not.toBeInTheDocument();
      }
      unmount();
    }
  });

  it("searches only inside the sections the role can see", () => {
    const adminQuestion = "¿Cómo valido un pago?";
    fireSearch(adminQuestion);
    expect(screen.queryByRole("button", { name: adminQuestion })).not.toBeInTheDocument();
    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
  });

  it("finds the same question for the role that owns it", () => {
    mockRole = "admin";
    fireSearch("¿Cómo valido un pago?");
    expect(screen.getByRole("button", { name: "¿Cómo valido un pago?" })).toBeInTheDocument();
  });

  it("counts only the visible sections in the «Qué encontrarás aquí» panel", () => {
    mockRole = "trainer";
    render(<AyudaPage />);

    const panel = within(screen.getByRole("heading", { name: "Qué encontrarás aquí" }).parentElement!);
    expect(panel.getByText(ENTRENADOR)).toBeInTheDocument();
    expect(panel.queryByText(ADMINISTRADOR)).not.toBeInTheDocument();
    expect(panel.queryByText(FAMILIA)).not.toBeInTheDocument();
  });
});

function fireSearch(value: string): void {
  render(<AyudaPage />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar una pregunta" }), {
    target: { value },
  });
}
