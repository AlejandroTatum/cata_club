/**
 * Nav/guard parity — the test that would have caught issue #762.
 *
 * The reported defect was never "the wrong page opened". It was that the shell
 * OFFERED a destination and the destination's own guard then refused it: for
 * `ADMINISTRADOR + ENTRENADOR`, the four rows of the "Entrenar" group answered
 * two different ways, two bouncing and two entering, with the refusal toast
 * still on screen over the page that had worked. Two readings of one account —
 * the rail read the union of the roles, `ProtectedRoute` read a single role
 * picked by precedence — and nothing in the suite compared them.
 *
 * This file compares them, for every role, and it does so without writing the
 * answer down anywhere:
 *
 *  - the OFFER side is read off a rendered `AppShell`: every anchor the shell
 *    actually puts in front of the person, rail rows, brand link, mobile tab
 *    bar and the user menu behind its trigger. Nothing is re-derived from
 *    `getNavGroupsForRoles`; if a row exists in the DOM it is checked.
 *  - the GUARD side is read off each route's own `page.tsx` — the literal
 *    `allowedRoles` prop the route hands `ProtectedRoute`. A table of routes
 *    and roles copied into this file would be a second copy of the rule whose
 *    two copies disagreeing is the whole bug, and it would drift the first
 *    time a guard widened.
 *
 * @vitest-environment jsdom
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AppShell from "@/components/shell/AppShell";
import { canAccess } from "@/lib/auth-utils";
import type { UserRole } from "@/types/domain";

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
}

interface MockImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
}

function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
    get length(): number {
      return Object.keys(store).length;
    },
  } as Storage;
}

vi.mock("next/navigation", (): { usePathname: () => string; useRouter: () => { push: () => void } } => ({
  usePathname: (): string => "/dashboard",
  useRouter: (): { push: () => void } => ({ push: vi.fn() }),
}));

vi.mock("next/link", (): { __esModule: boolean; default: (props: MockLinkProps) => React.ReactElement } => ({
  __esModule: true,
  default: ({ children, href, ...props }: MockLinkProps): React.ReactElement => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", (): { __esModule: boolean; default: (props: MockImageProps) => React.ReactElement } => ({
  __esModule: true,
  default: (props: MockImageProps): React.ReactElement => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/contexts/AuthContext", (): { useAuth: typeof useAuth } => ({
  useAuth: vi.fn<typeof useAuth>(),
}));

vi.mock("@/services/api", () => ({
  fetchNotificaciones: () => Promise.resolve({ items: [], total: 0, skip: 0, limit: 20 }),
  marcarNotificacionLeida: () => Promise.resolve(undefined),
}));

import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

const mockUseAuth = vi.mocked(useAuth);

// ---------------------------------------------------------------------------
// The GUARD side — read off the route components themselves
// ---------------------------------------------------------------------------

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app");

/**
 * The routes that carry no `ProtectedRoute` because they are public — the
 * landing and the help page, both reachable signed out.
 *
 * Named rather than inferred from the absence of a guard: "this file has no
 * guard" and "this route needs none" are different statements, and reading the
 * first as the second would let a protected page that lost its guard pass this
 * test as public.
 */
const PUBLIC_ROUTES: readonly string[] = ["/", "/ayuda"];

/** Every role a session can carry. Typed as a total record so a fifth role cannot be added without landing here. */
const ROLE_UNDER_TEST: Record<UserRole, string> = {
  admin: "Ana Admin",
  trainer: "Carlos Entrenador",
  representante: "Marta Vera",
  estudiante: "Luis Jugador",
  unsupported: "Sin Rol",
};

/** Block and line comments, removed before matching so a `allowedRoles={[...]}` quoted inside a doc comment is not read as a guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function pageFileFor(href: string): string {
  return path.join(APP_DIR, href === "/" ? "" : href.slice(1), "page.tsx");
}

/**
 * The `allowedRoles` a route hands `ProtectedRoute`, or `null` when the route
 * declares no guard at all.
 *
 * Throws rather than guesses on anything it cannot read exactly: a route that
 * grew a second guard, or one whose roles are not plain literals, must fail
 * this suite loudly instead of being silently skipped.
 */
function guardRolesFor(href: string): UserRole[] | null {
  const file = pageFileFor(href);
  if (!existsSync(file)) {
    throw new Error(`The shell offers ${href} but there is no route component at ${file}`);
  }

  const matches = [...stripComments(readFileSync(file, "utf8")).matchAll(/allowedRoles=\{\[([\s\S]*?)\]\}/g)];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`${href} declares ${matches.length} allowedRoles props; this test can only read one`);
  }

  const literals = matches[0][1].match(/"[^"]+"/g);
  if (literals === null) {
    throw new Error(`${href} declares allowedRoles that are not plain string literals; read it by hand`);
  }
  return literals.map((literal) => literal.slice(1, -1) as UserRole);
}

// ---------------------------------------------------------------------------
// The OFFER side — read off a rendered shell
// ---------------------------------------------------------------------------

/**
 * Every internal destination the shell puts in front of this role, including
 * the one behind the user-menu trigger — a row a person has to click twice to
 * see is still a row the product offered them.
 */
function destinationsOfferedTo(role: UserRole): string[] {
  mockUseAuth.mockReturnValue(createAuthenticatedAuth(role, ROLE_UNDER_TEST[role]));
  const { container, unmount } = render(<AppShell title="Panel">{null}</AppShell>);

  fireEvent.click(screen.getByRole("button", { name: `Menú de cuenta de ${ROLE_UNDER_TEST[role]}` }));

  const hrefs = [...container.querySelectorAll("a[href]")]
    .map((anchor) => anchor.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/"));

  unmount();
  return [...new Set(hrefs)];
}

describe("nav/guard parity — every row the shell offers, its own route admits", (): void => {
  beforeEach((): void => {
    mockUseAuth.mockReset();
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        dispatchEvent: (): boolean => true,
      })),
    );
  });

  it.each(Object.keys(ROLE_UNDER_TEST) as UserRole[])(
    "offers %s nothing its own route guard would refuse",
    (role): void => {
      const offered = destinationsOfferedTo(role);

      // A role whose shell offered nothing at all would pass every assertion
      // below without proving anything.
      expect(offered.length).toBeGreaterThan(0);

      const refused = offered.filter((href) => {
        const allowed = guardRolesFor(href);
        return allowed !== null && !canAccess(role, allowed);
      });

      expect(refused).toEqual([]);
    },
  );

  it.each(Object.keys(ROLE_UNDER_TEST) as UserRole[])(
    "offers %s no route that quietly lost its guard",
    (role): void => {
      const unguarded = destinationsOfferedTo(role).filter((href) => guardRolesFor(href) === null);

      expect(unguarded.filter((href) => !PUBLIC_ROUTES.includes(href))).toEqual([]);
    },
  );

  it("keeps the public list honest — a route that grew a guard is no longer public", (): void => {
    const stillUnguarded = PUBLIC_ROUTES.filter((href) => guardRolesFor(href) === null);

    expect(stillUnguarded).toEqual(PUBLIC_ROUTES);
  });

  /**
   * The guard side is read by a regex, and a regex that silently matched
   * nothing would make every assertion above vacuously true. This is the
   * canary: the one route the issue's own table names, read the same way.
   */
  it("really is reading the route components, not an empty match", (): void => {
    expect(guardRolesFor("/trainer")).toEqual(["trainer"]);
    expect(guardRolesFor("/trainer/attendance")).toEqual(["trainer", "admin"]);
  });
});
