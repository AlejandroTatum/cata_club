/**
 * Component tests for the /login/activacion page.
 *
 * Issue #940: the redirect out of this page must obey the backend's own
 * gate decision (`activacionCompleta`), not recompute it from the two raw
 * facts (`correoVerificado`, `altaPresencialCompletada`) — an admin/
 * entrenador without a membership has the facts False but the decision
 * True, and must not stay trapped here.
 *
 * Issue #1045: the screen used to only offer navigation OUT (a resend
 * button, a link to /verificar-correo) for a condition it already knows how
 * to read and display. These tests cover completing that verification
 * in place — pasting the code or link, confirming without leaving the
 * page, the state updating with no re-login, the two conditions no longer
 * looking like interchangeable checkboxes, and a dead code/link saying what
 * to do next instead of just failing quietly.
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

const mockVerificarCorreo = vi.fn();
const mockReenviarVerificacionCorreo = vi.fn();
vi.mock("@/services/api", () => ({
  verificarCorreo: (...args: unknown[]) => mockVerificarCorreo(...args),
  reenviarVerificacionCorreo: (...args: unknown[]) => mockReenviarVerificacionCorreo(...args),
}));

const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: mockShowSuccess,
  }),
}));

// Same stub as LoginPage.test.tsx: only the content under test matters here,
// not the shell's own layout. Wrapped in a spy (#1045) so the tests below can
// assert on the props ActivationPage hands the shell — `hideBack` in
// particular — without rendering the real composition.
const mockAuthShell = vi.fn(
  ({ children }: { children: React.ReactNode }): React.ReactElement => <>{children}</>,
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
import { createAuthenticatedAuth, createMockSession } from "@/components/__tests__/test-utils";
import type { ActivationSession } from "@/lib/activation-reasons";

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  mockReplace.mockReset();
  mockUseAuth.mockReset();
  mockAuthShell.mockClear();
  mockVerificarCorreo.mockReset();
  mockReenviarVerificacionCorreo.mockReset();
  mockReenviarVerificacionCorreo.mockResolvedValue({ mensaje: "Enviado." });
  mockShowSuccess.mockClear();
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

  it("stays on the page and renders the checklist when the decision is incomplete", async () => {
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: false,
      activacionCompleta: false,
    };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session }));

    render(<ActivationPage />);

    expect(await screen.findByRole("list", { name: "Estado de activación" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Issue reported against staging: a stale token can leave `activacionCompleta`
  // false while both raw facts already read true — the explanatory box below
  // the checklist has nothing left to say in that combination, and used to
  // render anyway as an empty bordered bar with no text inside it.
  it("does not render the empty explanatory box when both facts are already true", async () => {
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: true,
      activacionCompleta: false,
    };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session }));

    const { container } = render(<ActivationPage />);

    await screen.findByRole("list", { name: "Estado de activación" });
    expect(container.querySelector("div.rounded-ctl")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #1045 — verifying the email without leaving /login/activacion.
//
// Shared helpers below: every scenario needs an authenticated-but-pending
// session on screen, most need to type a code and press the one button that
// submits it, and the two "state updates in place" scenarios need a
// `refreshSession` that actually swaps the mocked session — three shapes of
// setup that would otherwise repeat, token-for-token, across every test.
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

/** Authenticates as the pending session and renders the page. */
function renderPending(session: ActivationSession = pendingSession(), authOverrides?: AuthOverrides): RenderResult {
  mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session, ...authOverrides }));
  return render(<ActivationPage />);
}

/** Types the pasted value into the one field and presses the one button that submits it. */
async function submitToken(value: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText(/código o enlace de verificación/i), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: /^verificar correo$/i }));
}

/**
 * A `refreshSession` double that, once awaited, re-points the mocked
 * `useAuth()` at `nextSession` — standing in for the BFF round-trip that
 * really updates `AuthContext`'s state after a successful verification.
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

describe("ActivationPage — verifying the email in place (#1045)", () => {
  // AC1 — completing the verification without leaving the page.
  it("offers a field to paste the code or link, and a button to confirm it right here", async () => {
    renderPending();

    expect(await screen.findByLabelText(/código o enlace de verificación/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^verificar correo$/i })).toBeInTheDocument();
  });

  it("reads the token out of a pasted full link and confirms with it", async () => {
    mockVerificarCorreo.mockResolvedValue(undefined);
    const session = pendingSession();
    renderPending(session, { refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated", session }) });

    await submitToken("https://cataclub.com/verificar-correo?token=abc123");

    await waitFor(() => expect(mockVerificarCorreo).toHaveBeenCalledWith("abc123"));
  });

  // AC2 — the state updates in place, with no return to /login.
  it("updates the checklist after verifying, without asking to sign in again", async () => {
    const pending = pendingSession();
    const verified = { ...pending, correoVerificado: true };
    mockVerificarCorreo.mockResolvedValue(undefined);
    const mockRefreshSession = mockRefreshTo(verified);
    const { rerender } = renderPending(pending, { refreshSession: mockRefreshSession });

    await submitToken("token-valido");

    await waitFor(() => expect(mockRefreshSession).toHaveBeenCalledTimes(1));
    rerender(<ActivationPage />);

    // The pending explanation for BOTH conditions must be gone; only the
    // alta presencial one remains, and no re-login was ever requested.
    expect(
      screen.queryByText("Le faltan verificar su correo y completar la inscripción presencial en el club."),
    ).not.toBeInTheDocument();
    expect(await screen.findByText(/Complete la inscripción presencial en el club/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalledWith("/login");
  });

  // AC3 — both conditions complete after verifying continues straight to the panel.
  it("continues on to the panel when verifying leaves both conditions complete", async () => {
    const pending = pendingSession({ altaPresencialCompletada: true });
    const complete = { ...pending, correoVerificado: true, activacionCompleta: true };
    mockVerificarCorreo.mockResolvedValue(undefined);
    const mockRefreshSession = mockRefreshTo(complete);
    const { rerender } = renderPending(pending, { refreshSession: mockRefreshSession });

    await submitToken("token-valido");

    await waitFor(() => expect(mockRefreshSession).toHaveBeenCalledTimes(1));
    rerender(<ActivationPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/student"));
  });

  // Review finding on #1050: the verification can succeed in the backend at
  // the exact moment the person's OWN session ends (expired, or a logout in
  // another tab) — `refreshSession()` then answers "unauthenticated", the
  // guard effect sends this screen to /login on its own, and a message set
  // on THIS page's local state would be thrown away with it before anyone
  // reads it. The news has to survive that redirect.
  it("still says the verification worked when the session ends at that exact moment", async () => {
    mockVerificarCorreo.mockResolvedValue(undefined);
    const mockRefreshSession = vi.fn().mockResolvedValue({ kind: "unauthenticated" });
    renderPending(pendingSession(), { refreshSession: mockRefreshSession });

    await submitToken("token-valido");

    await waitFor(() =>
      expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringMatching(/verificad.*iniciar sesión/i)),
    );
  });

  // AC4 — the condition that is not resolved here reads differently from the one that is.
  it("marks the club-only condition as distinct from the one this screen can resolve", async () => {
    renderPending(pendingSession({ correoVerificado: true }));

    expect(await screen.findByText(/se completa en el club/i)).toBeInTheDocument();
    // The verified condition carries no such note — it is the one this
    // screen resolves, not the one deferred to an in-person step.
    const correoItem = screen.getByText("Correo electrónico verificado").closest("li");
    expect(correoItem).not.toHaveTextContent(/se completa en el club/i);
  });

  // AC5 — resending stays available and is not displaced by the new form.
  it("keeps the resend button available alongside the new inline form", async () => {
    renderPending();

    expect(await screen.findByRole("button", { name: /reenviar correo de verificación/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^verificar correo$/i })).toBeInTheDocument();
  });

  // AC6 — a dead code/link says what to do next, without leaving the page.
  it("tells the person what to do next when the code or link is invalid or expired", async () => {
    mockVerificarCorreo.mockRejectedValue(new Error("token inválido"));
    renderPending();

    await submitToken("token-vencido");

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/no es válido|venció/i);
    expect(error).toHaveTextContent(/reenviar correo de verificación/i);
    // Still on the same screen — never redirected, checklist still standing.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("list", { name: "Estado de activación" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #1045 — the corner exit no longer offers the landing to an
// authenticated person stuck at this gate.
// ---------------------------------------------------------------------------

describe("ActivationPage — the corner exit", () => {
  it("tells AuthShell to hide the corner exit, since 'Cerrar sesión' is the deliberate one", async () => {
    renderPending();

    await screen.findByRole("list", { name: "Estado de activación" });
    expect(mockAuthShell).toHaveBeenCalledWith(expect.objectContaining({ hideBack: true }));
  });
});
