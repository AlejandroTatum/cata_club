/**
 * Tests for the generic API client's 401 refresh-and-retry behavior
 * (src/services/api.ts, Phase 4).
 *
 * Verifies: a retryable request (GET/PUT) that gets a 401 triggers exactly
 * one /api/auth/refresh call and retries exactly once; two concurrent 401s
 * share a single in-flight refresh (no refresh storm); a request already
 * retried never triggers a second refresh (no infinite loop); a failed
 * refresh propagates the failure and notifies subscribers (AuthContext
 * clears the session); and a non-retryable POST is never auto-replayed.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchPaymentValidations,
  updatePaymentValidation,
  enrollStudent,
  subscribeAuthFailure,
  setCurrentMockRole,
  ApiClientError,
} from "../api";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ message: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.NEXT_PUBLIC_USE_MOCKS = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_USE_MOCKS;
});

describe("401 refresh-and-retry", () => {
  it("retries a GET exactly once after a successful refresh", async () => {
    let paymentsCallCount = 0;
    let refreshCallCount = 0;

    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") {
        refreshCallCount += 1;
        return Promise.resolve(okResponse({ success: true }));
      }
      paymentsCallCount += 1;
      // Issue #400 (criterio 4/5): `/api/payments` now responds
      // `{ items, total }`, not a bare array — `fetchPaymentValidations`
      // unwraps `.items`.
      return Promise.resolve(
        paymentsCallCount === 1 ? unauthorizedResponse() : okResponse({ items: [], total: 0 }),
      );
    });

    const result = await fetchPaymentValidations();

    expect(result).toEqual([]);
    expect(paymentsCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
  });

  it("retries a PUT exactly once (idempotent method) after a successful refresh", async () => {
    let putCallCount = 0;

    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") return Promise.resolve(okResponse({ success: true }));
      putCallCount += 1;
      return Promise.resolve(
        putCallCount === 1
          ? unauthorizedResponse()
          : okResponse({
              id: "pv-001",
              studentName: "X",
              membershipPeriod: "x",
              membershipType: "x",
              expectedAmount: 1,
              paymentMethod: "x",
              uploadedAt: "x",
              currentMembershipStatus: "activa",
              proofFileType: "pdf",
              validationStatus: "validado",
            }),
      );
    });

    const result = await updatePaymentValidation("pv-001", { action: "approved" });

    expect(result.validationStatus).toBe("validado");
    expect(putCallCount).toBe(2);
  });

  it("shares one in-flight refresh across two concurrent 401s (no refresh storm)", async () => {
    let refreshCallCount = 0;
    let paymentsCallCount = 0;

    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") {
        refreshCallCount += 1;
        return Promise.resolve(okResponse({ success: true }));
      }
      paymentsCallCount += 1;
      // The first two calls are the two concurrent original requests -> 401.
      // Anything after that is a retry -> succeed. `{ items, total }`, same
      // reason as the previous test.
      return Promise.resolve(
        paymentsCallCount <= 2 ? unauthorizedResponse() : okResponse({ items: [], total: 0 }),
      );
    });

    const [r1, r2] = await Promise.all([fetchPaymentValidations(), fetchPaymentValidations()]);

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(refreshCallCount).toBe(1);
  });

  it("never retries more than once (no infinite/recursive retry loop)", async () => {
    let paymentsCallCount = 0;

    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") return Promise.resolve(okResponse({ success: true }));
      paymentsCallCount += 1;
      // Every call 401s, even after a refreshed token — must not loop forever.
      return Promise.resolve(unauthorizedResponse());
    });

    await expect(fetchPaymentValidations()).rejects.toThrow(ApiClientError);

    // Exactly the original call + exactly one retry — never more.
    expect(paymentsCallCount).toBe(2);
  });

  it("propagates the failure and notifies subscribers when refresh itself fails", async () => {
    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") return Promise.resolve(new Response(null, { status: 401 }));
      return Promise.resolve(unauthorizedResponse());
    });

    const listener = vi.fn();
    const unsubscribe = subscribeAuthFailure(listener);

    try {
      await expect(fetchPaymentValidations()).rejects.toThrow(ApiClientError);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("does not auto-retry a non-idempotent POST on 401", async () => {
    let refreshCallCount = 0;
    let enrollCallCount = 0;

    vi.mocked(global.fetch).mockImplementation((url) => {
      if (url === "/api/auth/refresh") {
        refreshCallCount += 1;
        return Promise.resolve(okResponse({ success: true }));
      }
      enrollCallCount += 1;
      return Promise.resolve(unauthorizedResponse());
    });

    await expect(
      enrollStudent({
        alumno: { nombres: "Ana", apellidos: "Pérez", cedula: "1712345678", fechaNacimiento: "2000-01-15", telefono: "0991234567" },
        credencialesAlumno: { correo: "ana@example.com", contrasenia: "password8" },
        fichaMedica: { tipoSangre: "O_POSITIVO", condicionesSalud: "", alergias: "", contactoEmergencia: "María", telefonoEmergencia: "0997654321" },
      }),
    ).rejects.toThrow(ApiClientError);

    // The POST itself is called exactly once — never replayed.
    expect(enrollCallCount).toBe(1);
  });
});

/**
 * Finding 3 (bounded correction): getMockRoleHeader() must source the
 * x-mock-role header from the in-memory role AuthContext mirrors via
 * setCurrentMockRole() — the old localStorage-backed session key is never
 * written by the real auth flow anymore, so relying on it left mock-mode
 * payments requests permanently unauthorized.
 */
describe("mock role header — setCurrentMockRole", () => {
  afterEach(() => {
    setCurrentMockRole(null);
  });

  it("sends x-mock-role from the current in-memory role, not localStorage", async () => {
    setCurrentMockRole("admin");
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-mock-role")).toBe("admin");
  });

  it("omits x-mock-role when no current role has been set", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-mock-role")).toBeNull();
  });

  it("omits x-mock-role when USE_MOCKS is false, even with a role set", async () => {
    process.env.NEXT_PUBLIC_USE_MOCKS = "false";
    setCurrentMockRole("admin");
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-mock-role")).toBeNull();
  });
});
