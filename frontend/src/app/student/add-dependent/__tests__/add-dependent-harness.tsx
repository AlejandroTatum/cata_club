/**
 * Shared scaffolding for the `/student/add-dependent` suites.
 *
 * Both files that render this wizard need the identical seven-mock preamble
 * before the page will mount at all: the route guard opened, the App Router
 * pointed at this path, `next/link` and `next/image` flattened to plain
 * elements, a signed-in representante in the auth context, a silent toast
 * bus, and the portal fetch that sources `representanteId`. Written out per
 * file that block is ~40 lines of pure boilerplate, and it was byte-identical
 * in both — the largest duplicated region this feature's test code has.
 *
 * Only SCAFFOLDING lives here — never assertions, and never a walkthrough
 * that encodes what a step is supposed to do. What each suite proves stays
 * written out in its own file, next to the reason it is being proved. This is
 * the same call `src/app/api/__tests__/bff-route-harness.ts` made for the BFF
 * route tests, and its module header carries the longer argument.
 *
 * The doubles are exported as factories rather than installed from here
 * because `vi.mock` is hoisted to the top of the file that calls it: a
 * `vi.mock` issued from inside this module would never apply to the importer.
 * Each suite issues its own `vi.mock` and delegates the BODY here, which also
 * keeps the mocked module list visible in the file that depends on it.
 *
 * `@/services/api` is deliberately NOT here. The two suites mock it
 * differently and for a reason — one keeps the real `ApiClientError` via
 * `importOriginal` because it builds error instances, the other does not —
 * and routing it through this module would also make the mock factory import
 * a module that itself imports `@/services/api`.
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fetchStudentPortal } from "@/services/api";

/** The route both suites render, and the one the App Router double reports. */
export const ADD_DEPENDENT_PATH = "/student/add-dependent";

/** Opens the route guard so the page under test mounts unauthenticated. */
export function protectedRouteDouble(): Record<string, unknown> {
  return { default: ({ children }: { children: ReactNode }) => <>{children}</> };
}

/**
 * `next/navigation` backed by jsdom's REAL history — the wizard keeps its
 * step in the URL, so a frozen fixture would assert nothing about Back.
 */
export function navigationDouble(): Record<string, unknown> {
  return {
    usePathname: () => ADD_DEPENDENT_PATH,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => useTestSearchParams(),
  };
}

/** `next/link` as a plain anchor, so `href` stays assertable. */
export function nextLinkDouble(): Record<string, unknown> {
  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; href: string }) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
  };
}

/** `next/image` reduced to its alt text; jsdom loads nothing either way. */
export function nextImageDouble(): Record<string, unknown> {
  return {
    __esModule: true,
    // eslint-disable-next-line @next/next/no-img-element
    default: ({ alt }: { alt: string }) => <img alt={alt} />,
  };
}

/** A signed-in REPRESENTANTE — the only role that reaches this wizard. */
export function authContextDouble(): Record<string, unknown> {
  return {
    useAuth: () => ({
      session: {
        user: { id: "9", name: "Mishell", email: "m@cataclub.com", role: "representante" },
        roles: ["REPRESENTANTE"],
      },
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
      refreshSession: vi.fn(),
    }),
  };
}

/** A silent toast bus: neither suite asserts on toasts. */
export function toastContextDouble(): Record<string, unknown> {
  return { useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) };
}

/**
 * Seed the portal summary the page reads on mount, reset the address bar, and
 * unmount between cases. Call once at the top level of a suite.
 *
 * `personaId` is what becomes `representanteId`, and the submit button stays
 * disabled until this promise lands — a suite that skips it gets a wizard
 * that silently refuses to submit.
 */
export function installAddDependentHarness(): void {
  beforeEach(() => {
    vi.mocked(fetchStudentPortal).mockResolvedValue({
      self: {
        personaId: "9",
        nombres: "Mishell",
        apellidos: "Rivadeneira",
        fechaNacimiento: "1990-01-01",
        recentSessions: [],
        membership: null,
        representante: null,
        representanteId: null,
      },
      representados: [],
      membershipPlans: [],
    });
    resetTestHistory(ADD_DEPENDENT_PATH);
  });

  afterEach(() => {
    cleanup();
  });
}
