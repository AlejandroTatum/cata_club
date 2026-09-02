/**
 * The enrolment confirmation must never announce a session it does not have.
 *
 * This is the regression lock for issue #717 — the same "2xx but no cookie"
 * defect `/login` was fixed for in #711/#712, reached through the other door.
 * `POST /api/enrollment` answers 201 and carries `Set-Cookie` for both auth
 * cookies (see src/app/api/enrollment/route.ts, which calls `setAuthCookies`
 * exactly as the login route does). Those cookies are `HttpOnly`, so no code
 * on this page can see whether the browser kept them — and the wizard used to
 * `await refreshSession()`, throw the answer away, and print
 * "Su cuenta ya está creada y la sesión, iniciada." regardless.
 *
 * Observed in WebKit over plain http, which refuses `Secure` cookies on an
 * insecure origin, and identically reachable with cookies blocked for the
 * site, in a private window, under Safari's ITP, or behind a proxy that
 * strips `Set-Cookie`. The person finished a five-step wizard carrying their
 * child's personal and medical data, was told they were signed in, pressed
 * "Ir a mi cuenta", and landed silently back on /login.
 *
 * Unlike `EnrollPage.test.tsx`, which stubs `useAuth` and is therefore about
 * the form, this file wires the REAL `AuthProvider` -> `services/auth` and
 * mocks only `fetch`, the actual network boundary. That is deliberate: the
 * optimism being locked out was not in any one layer, it was in the seam
 * between "the enrolment returned 201" and "a session exists", and a test
 * that stubs the seam cannot see it.
 *
 * `enrollStudent` stays mocked: that the enrolment SUCCEEDED is the premise
 * of every case here, not the thing under test. Which is also the one risk
 * this screen carries that the login screen does not — the student row is
 * already written, so a message that reads as "it failed" would send a
 * parent to enrol the same child twice.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { AuthProvider } from "@/contexts/AuthContext";
import { enrollStudent, fetchInstituciones, fetchTarifas } from "@/services/api";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import { enrollFieldId } from "@/app/student/enroll/enroll-utils";
import type { AuthSession } from "@/services/auth";

// ---------------------------------------------------------------------------
// Mocks — the router, the wizard's catalogue calls, the enrolment POST, and
// `fetch`. `AuthContext`, `services/auth` and the page itself are the real
// modules.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchInstituciones: vi.fn(),
  fetchTarifas: vi.fn(),
  // `AuthContext` imports these three from the API client.
  subscribeAuthFailure: () => () => undefined,
  discardInFlightRefresh: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

const NEW_STUDENT_SESSION: AuthSession = {
  user: {
    id: "42",
    name: "Sofia Martinez",
    email: "sofia@example.com",
    role: "estudiante",
    representanteId: null,
    activo: true,
  },
  roles: ["ESTUDIANTE"],
  loggedInAt: "2026-08-27T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stand in for the browser's cookie jar.
 *
 * The jar starts EMPTY — this is an anonymous visitor arriving at the public
 * wizard, so the mount hydration must find nothing, exactly as it does in a
 * real browser.
 *
 * The enrolment itself always succeeds; `enrollStudent` is mocked to resolve
 * `{ enrolled: true }` in every case. What `sessionAfterEnrollment` decides is
 * what the confirmation round trip finds afterwards:
 * · "kept"        — the browser honoured `Set-Cookie`, so GET /api/auth/session
 *                   answers with the session.
 * · "dropped"     — it did not, so that route answers with the anonymous
 *                   `{ authenticated: false }` 200 the BFF really returns for
 *                   a request carrying no cookies (see
 *                   src/app/api/auth/session/route.ts).
 * · "outage"      — a 503, which `fetchSession` maps to `outage` and which
 *                   says NOTHING about the cookies.
 */
function mockNetwork(sessionAfterEnrollment: "kept" | "dropped" | "outage"): void {
  vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      if (sessionAfterEnrollment === "outage") return jsonResponse({ detail: "no disponible" }, 503);
      return sessionAfterEnrollment === "kept"
        ? jsonResponse(NEW_STUDENT_SESSION)
        : jsonResponse({ authenticated: false });
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

/**
 * Walk the five-step wizard as a self-enrolment and press "Confirmar
 * inscripción" — the same walk `EnrollPage.test.tsx` already uses to reach
 * the confirmation screen.
 */
async function completeEnrollment(): Promise<void> {
  vi.mocked(enrollStudent).mockResolvedValueOnce({ enrolled: true });
  render(
    <AuthProvider>
      <EnrollPage />
    </AuthProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
  fillBirthDate(enrollFieldId("fechaNacimiento"), "1990-05-20");
  fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
  fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

  fireEvent.change(screen.getByLabelText(/tipo de sangre/i), { target: { value: "O_POSITIVO" } });
  fireEvent.change(screen.getByLabelText(/nombre del contacto/i), { target: { value: "Ana Martinez" } });
  fireEvent.change(screen.getByLabelText(/teléfono de emergencia/i), { target: { value: "0999888777" } });
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /confirmar inscripción/i }));

  await screen.findByText(/inscripción completada/i);
}

beforeEach(() => {
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
  // Re-armed per test, not in the `vi.mock` factory: `restoreAllMocks` below
  // strips implementations, and the wizard's fetch-on-mount effects would
  // then hang on an `undefined` return.
  vi.mocked(fetchInstituciones).mockResolvedValue([]);
  vi.mocked(fetchTarifas).mockResolvedValue([{ categoria: "Categoria Test", precio: "1.00" }]);
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EnrollPage — the confirmation's session claim is conditional on a confirmed session", () => {
  describe("when the browser does not keep the session cookies", () => {
    beforeEach(async () => {
      mockNetwork("dropped");
      await completeEnrollment();
    });

    /*
     * THE lock. If this ever goes green while the screen still says the
     * session started, the interface is lying to the person again — and this
     * time after they handed over a child's medical record.
     */
    it("never claims the session started", () => {
      expect(screen.queryByText(/la sesión, iniciada/i)).not.toBeInTheDocument();
    });

    /*
     * The other half of the lie, and the more expensive one. `/student` is a
     * protected route: offering it without a session offers a button whose
     * only outcome is a silent bounce back to /login, which is exactly what
     * the WebKit reproduction produced.
     */
    it("does not offer a link into the protected account area", () => {
      expect(screen.queryByRole("link", { name: /ir a mi cuenta/i })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /iniciar sesión/i })).toHaveAttribute("href", "/login");
    });

    it("says the browser did not store the session and how to fix it", () => {
      const notice = screen.getByTestId("enroll-session-not-confirmed");

      expect(notice).toHaveAttribute("role", "alert");
      expect(notice).toHaveTextContent(/este navegador no guardó la sesión/i);
      expect(notice).toHaveTextContent(/cookies/i);
      expect(notice).toHaveTextContent(/inicie sesión/i);
    });

    /*
     * The enrolment SUCCEEDED — the student row is written and the 201 is in
     * hand. A message that let this read as a failed enrolment would push a
     * parent to enrol the same child a second time, which is a worse outcome
     * than the stranding this fix is about.
     */
    it("says the enrolment was registered and the account exists, and not to repeat it", () => {
      const notice = screen.getByTestId("enroll-session-not-confirmed");

      expect(notice).toHaveTextContent(/su inscripción quedó registrada/i);
      expect(notice).toHaveTextContent(/su cuenta ya está creada/i);
      expect(notice).toHaveTextContent(/no repita la inscripción/i);
    });

    // The screen's own headline stays true: the enrolment did complete.
    it("still confirms the enrolment itself", () => {
      expect(screen.getByText(/inscripción completada/i)).toBeInTheDocument();
      expect(screen.getByText(/su cuenta ya está creada\. inicie sesión/i)).toBeInTheDocument();
    });
  });

  describe("when the confirmation hits a backend outage", () => {
    beforeEach(async () => {
      mockNetwork("outage");
      await completeEnrollment();
    });

    // An outage is not a confirmation either — the screen may only claim a
    // session it has an answer for.
    it("never claims the session started", () => {
      expect(screen.queryByText(/la sesión, iniciada/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /ir a mi cuenta/i })).not.toBeInTheDocument();
    });

    /*
     * #712 deliberately maps a 503 to an outage message rather than blaming
     * the browser, because an outage says nothing about the cookie jar and
     * sending someone into their browser settings during one is sending them
     * to fix something that was never broken. That distinction must survive
     * here.
     */
    it("blames the outage, not the browser's cookies", () => {
      const notice = screen.getByTestId("enroll-session-not-confirmed");

      expect(notice).toHaveTextContent(/el servicio no está disponible/i);
      expect(notice).not.toHaveTextContent(/cookies/i);
      expect(notice).not.toHaveTextContent(/navegación privada/i);
    });

    it("still says the enrolment was registered and not to repeat it", () => {
      const notice = screen.getByTestId("enroll-session-not-confirmed");

      expect(notice).toHaveTextContent(/su inscripción quedó registrada/i);
      expect(notice).toHaveTextContent(/su cuenta ya está creada/i);
      expect(notice).toHaveTextContent(/no repita la inscripción/i);
    });
  });

  describe("when the browser keeps the session cookies", () => {
    beforeEach(async () => {
      mockNetwork("kept");
      await completeEnrollment();
    });

    // The happy path is untouched: a normal enrolment still says the session
    // started and still points at the dashboard.
    it("announces the session and links to the account area", () => {
      expect(screen.getByText(/su cuenta ya está creada y la sesión, iniciada/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /ir a mi cuenta/i })).toHaveAttribute("href", "/student");
      expect(screen.queryByTestId("enroll-session-not-confirmed")).not.toBeInTheDocument();
    });

    it("confirms against the session route the rest of the app hydrates from", async () => {
      await waitFor(() => {
        const sessionCalls = vi
          .mocked(global.fetch)
          .mock.calls.filter(([input]) => String(input) === "/api/auth/session");
        // One on mount (anonymous visitor), one AFTER the enrolment — the
        // confirmation. Only cookies the browser really stored can answer it.
        expect(sessionCalls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
