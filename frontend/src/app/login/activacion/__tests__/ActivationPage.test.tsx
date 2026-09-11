/**
 * Component tests for the /login/activacion page.
 *
 * Issue #940: the redirect out of this page must obey the backend's own
 * gate decision (`activacionCompleta`), not recompute it from the two raw
 * facts (`correoVerificado`, `altaPresencialCompletada`) — an admin/
 * entrenador without a membership has the facts False but the decision
 * True, and must not stay trapped here.
 *
 * Issue #1102: this page used to show a checklist, a summary box, an inline
 * verification form, a resend button and two "check again" affordances all
 * at once. The verification email carries a LINK, not a code, so there is
 * no paste-and-confirm step to keep in place: this route now renders one of
 * two sequential screens instead — an email screen ("Verifique su correo")
 * while `correoVerificado` is false, and an enrolment screen ("Complete su
 * inscripción en el club") once the email is verified and only the
 * in-person enrolment remains. Both share the same `checkStatus` refresh;
 * the label on the primary button is the only thing that differs by which
 * fact is still pending when it is pressed.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import ActivationPage from "@/app/login/activacion/page";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockReenviarVerificacionCorreo = vi.fn();
vi.mock("@/services/api", () => ({
  reenviarVerificacionCorreo: (...args: unknown[]) => mockReenviarVerificacionCorreo(...args),
}));

// Same stub as LoginPage.test.tsx: only the content under test matters here,
// not the shell's own layout. Wrapped in a spy so the tests below can assert
// on the props ActivationPage hands the shell — `title`, `subtitle` and
// `hideBack` in particular — without rendering the real composition.
const mockAuthShell = vi.fn(
  ({ children }: { children: React.ReactNode; title?: string; subtitle?: string; hideBack?: boolean }): React.ReactElement =>
    <>{children}</>,
);
vi.mock("@/components/auth/AuthShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/auth/AuthShell")>(
    "@/components/auth/AuthShell",
  );
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => mockAuthShell(props),
  };
});

import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth, createMockSession, createUnauthenticatedAuth } from "@/components/__tests__/test-utils";
import type { ActivationSession } from "@/lib/activation-reasons";

const mockUseAuth = vi.mocked(useAuth);

/** Reads the `subtitle` prop most recently handed to `AuthShell`. */
function lastSubtitle(): string | undefined {
  return mockAuthShell.mock.calls.at(-1)?.[0]?.subtitle;
}

beforeEach(() => {
  mockReplace.mockReset();
  mockUseAuth.mockReset();
  mockAuthShell.mockClear();
  mockReenviarVerificacionCorreo.mockReset();
  mockReenviarVerificacionCorreo.mockResolvedValue({ mensaje: "Enviado." });
});

describe("ActivationPage", () => {
  it("redirects an admin whose alta presencial is incomplete to the dashboard when the backend's decision is complete", async () => {
    const session = { ...createMockSession(), altaPresencialCompletada: false, activacionCompleta: true };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Test User", { session }));

    render(<ActivationPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("stays on the page and renders the enrolment screen when the decision is incomplete", async () => {
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: false,
      activacionCompleta: false,
    };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session }));

    render(<ActivationPage />);

    expect(await screen.findByRole("button", { name: "Consultar estado nuevamente" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue #1102 — the two sequential screens.
// ---------------------------------------------------------------------------

function pendingSession(overrides?: Partial<ActivationSession>): ActivationSession {
  // Built off `createAuthenticatedAuth`'s own session, not `createMockSession`
  // directly, so `user.role` actually matches "estudiante" — the role every
  // test in this block authenticates as, and the one `getDefaultRoute` reads
  // once activation completes.
  return {
    ...(createAuthenticatedAuth("estudiante", "Test User").session as ActivationSession),
    correoVerificado: false,
    altaPresencialCompletada: false,
    activacionCompleta: false,
    ...overrides,
  };
}

type AuthOverrides = Parameters<typeof createAuthenticatedAuth>[2];

/** Authenticates as the given session and renders the page. */
function renderPending(session: ActivationSession = pendingSession(), authOverrides?: AuthOverrides): RenderResult {
  mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session, ...authOverrides }));
  return render(<ActivationPage />);
}

/**
 * A `refreshSession` double that, once awaited, re-points the mocked
 * `useAuth()` at `nextSession` — standing in for the BFF round-trip that
 * really updates `AuthContext`'s state after "Ya verifiqué mi correo" /
 * "Consultar estado nuevamente" is pressed.
 */
function mockRefreshTo(nextSession: ActivationSession): ReturnType<typeof vi.fn> {
  const mockRefreshSession = vi.fn().mockImplementation(async () => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("estudiante", "Test User", {
        session: nextSession,
        refreshSession: mockRefreshSession,
      }),
    );
    return { kind: "authenticated", session: nextSession };
  });
  return mockRefreshSession;
}

describe("ActivationPage — the email screen", () => {
  it("shows the check-again action and the pending-enrolment sentence when both facts are pending", async () => {
    renderPending(pendingSession());

    expect(await screen.findByRole("button", { name: "Ya verifiqué mi correo" })).toBeInTheDocument();
    expect(lastSubtitle()).toContain("Después queda un paso: la inscripción presencial en el club.");
    // No trace of the checklist/summary/inline-form screen this replaces.
    expect(screen.queryByLabelText(/código o enlace de verificación/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Inscripción presencial completada")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir verificación de correo" })).not.toBeInTheDocument();
  });

  it("omits the pending-enrolment sentence when only the email is pending", async () => {
    renderPending(pendingSession({ altaPresencialCompletada: true }));

    await screen.findByRole("button", { name: "Ya verifiqué mi correo" });
    expect(lastSubtitle()).not.toContain("Después queda un paso");
  });

  it("names the account's own address so the person knows which inbox to check", async () => {
    renderPending(pendingSession());

    await screen.findByRole("button", { name: "Ya verifiqué mi correo" });
    expect(lastSubtitle()).toContain("Le enviamos un enlace a estudiante@cataclub.com.");
  });

  it("keeps the resend action available as a secondary control", async () => {
    renderPending();

    expect(await screen.findByRole("button", { name: /reenviar correo de verificación/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ya verifiqué mi correo" })).toBeInTheDocument();
  });

  it("moves to the enrolment screen once checking status reports the email verified, with only the enrolment pending", async () => {
    const pending = pendingSession();
    const verified = { ...pending, correoVerificado: true };
    const mockRefreshSession = mockRefreshTo(verified);
    const { rerender } = renderPending(pending, { refreshSession: mockRefreshSession });

    fireEvent.click(await screen.findByRole("button", { name: "Ya verifiqué mi correo" }));

    await waitFor(() => expect(mockRefreshSession).toHaveBeenCalledTimes(1));
    rerender(<ActivationPage />);

    expect(await screen.findByRole("button", { name: "Consultar estado nuevamente" })).toBeInTheDocument();
    expect(screen.getByText("Su correo quedó verificado.")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalledWith("/login");
  });

  it("redirects straight through when checking status reports both conditions complete", async () => {
    const pending = pendingSession({ altaPresencialCompletada: true });
    const complete = { ...pending, correoVerificado: true, activacionCompleta: true };
    const mockRefreshSession = mockRefreshTo(complete);
    const { rerender } = renderPending(pending, { refreshSession: mockRefreshSession });

    fireEvent.click(await screen.findByRole("button", { name: "Ya verifiqué mi correo" }));

    await waitFor(() => expect(mockRefreshSession).toHaveBeenCalledTimes(1));
    rerender(<ActivationPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/student"));
  });

  it("reports the outage without moving screens when checking status fails", async () => {
    const mockRefreshSession = vi.fn().mockResolvedValue({ kind: "outage" });
    renderPending(pendingSession(), { refreshSession: mockRefreshSession });

    fireEvent.click(await screen.findByRole("button", { name: "Ya verifiqué mi correo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no se pudo consultar el estado/i);
    expect(screen.getByRole("button", { name: "Ya verifiqué mi correo" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("ActivationPage — the enrolment screen", () => {
  function enrolmentPendingSession(overrides?: Partial<ActivationSession>): ActivationSession {
    return pendingSession({ correoVerificado: true, altaPresencialCompletada: false, ...overrides });
  }

  it("shows the confirmation, the one status action, and no verification controls", async () => {
    renderPending(enrolmentPendingSession());

    expect(await screen.findByText("Correo verificado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consultar estado nuevamente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ya verifiqué mi correo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reenviar correo de verificación/i })).not.toBeInTheDocument();
  });

  it("does not show the just-verified confirmation on a plain load", async () => {
    renderPending(enrolmentPendingSession());

    await screen.findByText("Correo verificado");
    expect(screen.queryByText("Su correo quedó verificado.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shared behaviour across both screens.
// ---------------------------------------------------------------------------

describe("ActivationPage — logging out", () => {
  it("redirects an unauthenticated visitor straight to /login", async () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    render(<ActivationPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
  });
});

describe("ActivationPage — the corner exit", () => {
  it("tells AuthShell to hide the corner exit, since 'Cerrar sesión' is the deliberate one", async () => {
    renderPending();

    await screen.findByRole("button", { name: "Ya verifiqué mi correo" });
    expect(mockAuthShell).toHaveBeenCalledWith(expect.objectContaining({ hideBack: true }));
  });
});
