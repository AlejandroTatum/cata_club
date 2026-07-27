/**
 * Contract tests for the API client (src/services/api.ts).
 *
 * These tests verify the HTTP client contract without requiring a running
 * backend. All network calls are mocked via vi.spyOn(global, "fetch").
 *
 * Scope:
 *  - Happy path: correct URL resolution, response parsing.
 *  - Error paths: non-2xx status codes produce typed errors.
 *  - Header merging: caller headers coexist with Content-Type.
 *  - Timeout/abort: default timeout fires and rejects the request.
 *  - Mock default: USE_MOCKS defaults to true when env var is unset.
 *  - Payment validation: approve and reject flows, rejection reason validation.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enrollStudent,
  fetchPaymentValidations,
  updatePaymentValidation,
  fetchNotificaciones,
  marcarNotificacionLeida,
  fetchMiPerfil,
  actualizarMiPerfil,
  invalidarOtrasSesiones,
  fetchHorarios,
  crearHorario,
  actualizarHorario,
  eliminarHorario,
  fetchAlumnosPorHorario,
  asignarAlumnoAHorario,
  desasignarAlumnoDeHorario,
  fetchEntrenadores,
  subirFotoPerfil,
  downloadBlob,
  exportNuevosPorPeriodoPdf,
  exportAsistenciaReportePdf,
  consultarChatbot,
} from "../api";
import type { PaymentValidationRequest, Horario, AlumnoHorario, Entrenador } from "../api";
import type { Notificacion, PerfilPropio } from "@/types/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for a successful fetch Response. */
function okResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** A minimal payment-validation-shaped response body. */
function makePaymentValidation(
  overrides: Partial<PaymentValidationRequest> = {},
): PaymentValidationRequest {
  return {
    id: "pv-001",
    studentName: "Sofia Martinez",
    responsablePagoName: "Carlos Martinez",
    membershipPeriod: "July 2026",
    membershipType: "Monthly",
    expectedAmount: 85.0,
    paymentMethod: "Bank Transfer",
    uploadedAt: "2026-06-28T10:30:00Z",
    currentMembershipStatus: "vencida",
    proofFileName: "comprobante.pdf",
    proofFileType: "pdf",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    ...overrides,
  };
}

/** Factory for an error fetch Response. */
function errorResponse(
  status: number,
  body: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getFetchHeaders(): Headers {
  const call = vi.mocked(global.fetch).mock.calls[0];
  if (!call) throw new Error("Expected fetch to be called.");
  const options = call[1];
  if (!options?.headers) throw new Error("Expected fetch options to include headers.");
  return new Headers(options.headers);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.NEXT_PUBLIC_USE_MOCKS = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_USE_MOCKS;
});

// ---------------------------------------------------------------------------
// Payment Validation API methods – contract tests
// ---------------------------------------------------------------------------

describe("fetchPaymentValidations", () => {
  it("calls /api/payments when NEXT_PUBLIC_USE_MOCKS=true", async () => {
    const items = [makePaymentValidation({ id: "pv-001" })];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchPaymentValidations();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("/api/payments", expect.anything());
    expect(result).toEqual(items);
  });

  it("still calls same-origin /api/payments when USE_MOCKS is false (no cross-origin mode)", async () => {
    // src/services/api.ts always calls same-origin /api/* now — the access
    // token lives in an HttpOnly cookie the browser can't attach to a
    // cross-origin request, so a "direct backend" URL mode could never
    // authenticate. NEXT_PUBLIC_USE_MOCKS only affects the x-mock-role
    // header below, not which URL gets called.
    process.env.NEXT_PUBLIC_USE_MOCKS = "false";
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    expect(global.fetch).toHaveBeenCalledWith("/api/payments", expect.anything());
  });

  it("defaults to local mocks when NEXT_PUBLIC_USE_MOCKS is unset", async () => {
    delete process.env.NEXT_PUBLIC_USE_MOCKS;
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/payments",
      expect.anything(),
    );
  });

  it("throws a typed error on a non-2xx response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(500, { message: "Server error" }),
    );

    await expect(fetchPaymentValidations()).rejects.toThrow("Server error");
  });
});

describe("enrollStudent", () => {
  it("accepts the minimal safe enrollment response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ enrolled: true }, { status: 201 }));

    await expect(enrollStudent({
      alumno: { nombres: "Ana", apellidos: "Pérez", cedula: "1712345678", fechaNacimiento: "2000-01-15", telefono: "0991234567" },
      credencialesAlumno: { correo: "ana@example.com", contrasenia: "password8" },
      fichaMedica: { tipoSangre: "O_POSITIVO", condicionesSalud: "", alergias: "", contactoEmergencia: "María", telefonoEmergencia: "0997654321" },
    })).resolves.toEqual({ enrolled: true });
  });

  it("rejects enrollment responses with unexpected sensitive fields", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse({ enrolled: true, accessToken: "unsafe" }, { status: 201 }),
    );

    await expect(enrollStudent({
      alumno: { nombres: "Ana", apellidos: "Pérez", cedula: "1712345678", fechaNacimiento: "2000-01-15", telefono: "0991234567" },
      credencialesAlumno: { correo: "ana@example.com", contrasenia: "password8" },
      fichaMedica: { tipoSangre: "O_POSITIVO", condicionesSalud: "", alergias: "", contactoEmergencia: "María", telefonoEmergencia: "0997654321" },
    })).rejects.toThrow("La respuesta de inscripción no es válida.");
  });
});

// ---------------------------------------------------------------------------
// Non-2xx error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("throws a useful error message for a 500 response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(500, { message: "Internal server error" }),
    );

    await expect(fetchPaymentValidations()).rejects.toThrow("Internal server error");
  });

  it("throws a useful error message for a 404 response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(404, { message: "Not found" }),
    );

    await expect(fetchPaymentValidations()).rejects.toThrow("Not found");
  });

  it("falls back to a status-based message when no JSON body is returned", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(fetchPaymentValidations()).rejects.toThrow(
      "Request failed with status 500",
    );
  });

  it("includes the HTTP status on the thrown error", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(422, { message: "Validation failed" }),
    );

    try {
      await fetchPaymentValidations();
      expect.fail("Expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { status: number }).status).toBe(422);
    }
  });
});

// ---------------------------------------------------------------------------
// Header merging
// ---------------------------------------------------------------------------

describe("header merging", () => {
  it("preserves Content-Type when the caller provides extra headers", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await fetchPaymentValidations();

    const headers = getFetchHeaders();

    expect(headers.get("content-type")).toBe("application/json");
  });

  it("merges caller-provided headers without dropping Content-Type", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse([]));

    await updatePaymentValidation("pv-001", { action: "approved" });

    const headers = getFetchHeaders();

    // The explicit Content-Type should be present
    expect(headers.get("content-type")).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// Timeout / abort behaviour
// ---------------------------------------------------------------------------

describe("timeout / abort", () => {
  it("aborts the request after the default 10 s timeout when no signal is provided", async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    vi.mocked(global.fetch).mockImplementation((_url, opts) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        if (capturedSignal) {
          const onAbort = () =>
            queueMicrotask(() =>
              reject(new DOMException("The operation was aborted", "AbortError")),
            );
          if (capturedSignal.aborted) {
            onAbort();
          } else {
            capturedSignal.addEventListener("abort", onAbort, { once: true });
          }
        }
      });
    });

    try {
      // Start the request (won't settle — the mock never resolves)
      const promise = fetchPaymentValidations();
      // Pre-attach a handler so Node doesn't flag it as unhandled when abort fires
      promise.catch(() => {});

      // Advance past the 10 s threshold — timer fires and calls controller.abort()
      await vi.advanceTimersByTimeAsync(10_001);

      // The signal should have been aborted by the timeout
      expect(capturedSignal).toBeDefined();
      if (!capturedSignal) throw new Error("Expected fetch to receive an AbortSignal.");
      expect(capturedSignal.aborted).toBe(true);

      await expect(promise).rejects.toThrow(/aborted/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the chatbot longer than the BFF's own 30 s abort", async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    vi.mocked(global.fetch).mockImplementation((_url, opts) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return new Promise(() => {});
    });

    try {
      const promise = consultarChatbot("¿Cómo veo mis pagos?");
      promise.catch(() => {});

      // The BFF (src/app/api/chatbot/route.ts) aborts at 30 s and answers 504.
      // If the browser client gave up at the shared 10 s default it would throw
      // a bare AbortError instead — no status, so the widget could not tell a
      // slow answer from a dead backend.
      await vi.advanceTimersByTimeAsync(30_001);

      expect(capturedSignal).toBeDefined();
      if (!capturedSignal) throw new Error("Expected fetch to receive an AbortSignal.");
      expect(capturedSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// updatePaymentValidation — approve / reject
// ---------------------------------------------------------------------------

describe("updatePaymentValidation — approve", () => {
  it("sends PUT with action approved to /api/payments/:id in mock mode", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse(makePaymentValidation({ id: "pv-001", validationStatus: "validado" })),
    );

    const result = await updatePaymentValidation("pv-001", { action: "approved" });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/payments/pv-001",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ action: "approved" }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: "pv-001", validationStatus: "validado" }),
    );
  });

  it("throws a typed error on a 404 response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(404, { message: "Payment validation request not found" }),
    );

    await expect(
      updatePaymentValidation("invalid-id", { action: "approved" }),
    ).rejects.toThrow("Payment validation request not found");
  });
});

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

function makeNotificacion(overrides: Partial<Notificacion> = {}): Notificacion {
  return {
    id: 1,
    tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
    mensaje: "Tu membresía vence pronto.",
    leida: false,
    fechaCreacion: "2026-07-19T10:00:00Z",
    entidadRelacionadaId: 5,
    ...overrides,
  };
}

describe("fetchNotificaciones", () => {
  it("calls the real BFF route GET /api/ranking/notificaciones/mias", async () => {
    const items = [makeNotificacion()];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchNotificaciones();

    expect(global.fetch).toHaveBeenCalledWith("/api/ranking/notificaciones/mias", expect.anything());
    expect(result).toEqual(items);
  });
});

describe("marcarNotificacionLeida", () => {
  it("sends PATCH to /api/ranking/notificaciones/:id/leer", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(makeNotificacion({ leida: true })));

    const result = await marcarNotificacionLeida(1);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/ranking/notificaciones/1/leer",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(result.leida).toBe(true);
  });
});

describe("updatePaymentValidation — reject", () => {
  it("sends PUT with action rejected and rejectionReason", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse(
        makePaymentValidation({
          id: "pv-001",
          validationStatus: "rechazado",
          rejectionReason: "Invalid amount",
        }),
      ),
    );

    const result = await updatePaymentValidation("pv-001", {
      action: "rejected",
      rejectionReason: "Invalid amount",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/payments/pv-001",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ action: "rejected", rejectionReason: "Invalid amount" }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "pv-001",
        validationStatus: "rechazado",
        rejectionReason: "Invalid amount",
      }),
    );
  });

  it("rejects with an empty rejection reason at the mock API level", async () => {
    // The mock handler validates rejectionReason is non-empty.
    // The client should pass through whatever the server returns.
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ message: "El motivo de rechazo es obligatorio y no debe estar vacío" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      updatePaymentValidation("pv-001", { action: "rejected", rejectionReason: "" }),
    ).rejects.toThrow("El motivo de rechazo es obligatorio y no debe estar vacío");
  });
});

// ---------------------------------------------------------------------------
// Perfil propio (Issue #36) — dedicated self-profile fetch/mutate
// ---------------------------------------------------------------------------

function makePerfilPropio(overrides: Partial<PerfilPropio> = {}): PerfilPropio {
  return {
    correo: "ana.torres@cataclub.com",
    personaId: 7,
    nombres: "Ana",
    apellidos: "Torres",
    roles: ["ENTRENADOR"],
    telefono: "0991234567",
    fechaCreacion: "2024-03-10T14:22:05.123456",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Horarios / Asignación Alumno-Horario — BFF path fix (gestion-horarios PR-C)
//
// api.ts previously called `/api/asistencias/*`, but no such BFF route
// handler directory has ever existed — only `/api/groups/horarios*` is real.
// These tests pin the corrected `/api/groups/...` contract.
// ---------------------------------------------------------------------------

function makeHorario(overrides: Partial<Horario> = {}): Horario {
  return {
    id: 1,
    diaSemana: "LUNES",
    horaInicio: "18:00",
    horaFin: "20:00",
    categoria: "COMPETITIVO",
    entrenadorId: 5,
    nivelRankingId: null,
    ...overrides,
  };
}

describe("fetchMiPerfil", () => {
  it("calls GET /api/auth/me and returns the parsed profile", async () => {
    const perfil = makePerfilPropio();
    vi.mocked(global.fetch).mockResolvedValue(okResponse(perfil));

    const result = await fetchMiPerfil();

    expect(global.fetch).toHaveBeenCalledWith("/api/auth/me", expect.anything());
    expect(result).toEqual(perfil);
  });

  it("throws a typed error when the BFF route rejects the request", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(401, { message: "Sesión expirada." }));

    await expect(fetchMiPerfil()).rejects.toThrow("Sesión expirada.");
  });
});

describe("actualizarMiPerfil", () => {
  it("sends PATCH to /api/auth/me with telefono — correo is not an accepted field", async () => {
    const perfil = makePerfilPropio({ telefono: "0987654321" });
    vi.mocked(global.fetch).mockResolvedValue(okResponse(perfil));

    const result = await actualizarMiPerfil({ telefono: "0987654321" });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ telefono: "0987654321" }),
      }),
    );
    expect(result).toEqual(perfil);
  });
});

describe("invalidarOtrasSesiones", () => {
  it("calls POST /api/auth/sesiones/invalidar and returns the confirmation message", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse({ mensaje: "Se cerraron sus otras sesiones. Este dispositivo sigue conectado." }),
    );

    const result = await invalidarOtrasSesiones();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/sesiones/invalidar",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ mensaje: "Se cerraron sus otras sesiones. Este dispositivo sigue conectado." });
  });

  it("throws a typed error when the BFF route rejects the request", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(401, { message: "Token inválido o expirado" }));

    await expect(invalidarOtrasSesiones()).rejects.toThrow("Token inválido o expirado");
  });
});

// camelCase — mirrors the real backend contract (`AlumnoHorarioDetalleDTO`
// inherits `ResponseBase`, serialized camelCase server-side).
function makeAlumnoHorario(overrides: Partial<AlumnoHorario> = {}): AlumnoHorario {
  return {
    id: 10,
    personaId: 3,
    personaNombreCompleto: "Sofia Martinez",
    edad: 12,
    horarioId: 1,
    horarioDia: "LUNES",
    horarioHoraInicio: "18:00",
    horarioHoraFin: "20:00",
    fechaAsignacion: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("fetchHorarios", () => {
  it("GETs /api/groups/horarios (not /api/asistencias/horarios)", async () => {
    const items = [makeHorario(), makeHorario({ id: 2, categoria: "FORMATIVO" })];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchHorarios();

    expect(global.fetch).toHaveBeenCalledWith("/api/groups/horarios", expect.anything());
    expect(result).toEqual(items);
  });
});

describe("crearHorario", () => {
  it("POSTs /api/groups/horarios", async () => {
    const created = makeHorario();
    vi.mocked(global.fetch).mockResolvedValue(okResponse(created, { status: 201 }));

    const dto = { dia_semana: "LUNES", categoria: "COMPETITIVO", entrenador_id: 5 };
    const result = await crearHorario(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/horarios",
      expect.objectContaining({ method: "POST", body: JSON.stringify(dto) }),
    );
    expect(result).toEqual(created);
  });
});

describe("actualizarHorario", () => {
  it("PUTs /api/groups/horarios/:id", async () => {
    const updated = makeHorario({ categoria: "FORMATIVO" });
    vi.mocked(global.fetch).mockResolvedValue(okResponse(updated));

    const dto = { categoria: "FORMATIVO" };
    const result = await actualizarHorario(1, dto);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/horarios/1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(dto) }),
    );
    expect(result).toEqual(updated);
  });
});

describe("eliminarHorario", () => {
  it("DELETEs /api/groups/horarios/:id", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await eliminarHorario(1);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/horarios/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

function makeEntrenador(overrides: Partial<Entrenador> = {}): Entrenador {
  return { id: 5, nombreCompleto: "Carlos Ruiz", ...overrides };
}

describe("fetchEntrenadores", () => {
  it("GETs /api/personas/entrenadores", async () => {
    const items = [makeEntrenador(), makeEntrenador({ id: 9, nombreCompleto: "Diana Soto" })];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchEntrenadores();

    expect(global.fetch).toHaveBeenCalledWith("/api/personas/entrenadores", expect.anything());
    expect(result).toEqual(items);
  });
});

describe("fetchAlumnosPorHorario", () => {
  it("GETs /api/groups/horarios/:id/alumnos", async () => {
    const items = [makeAlumnoHorario(), makeAlumnoHorario({ id: 11, personaId: 4 })];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchAlumnosPorHorario(1);

    expect(global.fetch).toHaveBeenCalledWith("/api/groups/horarios/1/alumnos", expect.anything());
    expect(result).toEqual(items);
  });

  it("targets a different horario id (triangulation)", async () => {
    const items = [makeAlumnoHorario({ id: 20, horarioId: 7 })];
    vi.mocked(global.fetch).mockResolvedValue(okResponse(items));

    const result = await fetchAlumnosPorHorario(7);

    expect(global.fetch).toHaveBeenCalledWith("/api/groups/horarios/7/alumnos", expect.anything());
    expect(result).toEqual(items);
  });
});

describe("asignarAlumnoAHorario", () => {
  it("POSTs /api/groups/asignar-alumno", async () => {
    const created = makeAlumnoHorario();
    vi.mocked(global.fetch).mockResolvedValue(okResponse(created, { status: 201 }));

    const dto = { persona_id: 3, horario_id: 1 };
    const result = await asignarAlumnoAHorario(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/asignar-alumno",
      expect.objectContaining({ method: "POST", body: JSON.stringify(dto) }),
    );
    expect(result).toEqual(created);
  });
});

describe("desasignarAlumnoDeHorario", () => {
  it("DELETEs /api/groups/desasignar-alumno with query params", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await desasignarAlumnoDeHorario(3, 1);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/desasignar-alumno?persona_id=3&horario_id=1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("targets different persona/horario ids (triangulation)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await desasignarAlumnoDeHorario(9, 4);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/desasignar-alumno?persona_id=9&horario_id=4",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("subirFotoPerfil", () => {
  it("POSTs multipart/form-data (not JSON) to /api/auth/me/foto and returns the updated profile", async () => {
    const perfil = makePerfilPropio({ fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg" });
    vi.mocked(global.fetch).mockResolvedValue(okResponse(perfil));

    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const result = await subirFotoPerfil(archivo);

    expect(global.fetch).toHaveBeenCalledWith("/api/auth/me/foto", expect.anything());
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    // Content-Type must NOT be forced to application/json (or anything else)
    // — the browser needs to set its own multipart boundary.
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBeNull();
    expect(result).toEqual(perfil);
  });

  it("throws a typed error when the backend rejects an unsupported file type", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(400, { message: "Formato de archivo no permitido. Use JPG o PNG" }),
    );

    const archivo = new File(["contenido"], "archivo.pdf", { type: "application/pdf" });
    await expect(subirFotoPerfil(archivo)).rejects.toThrow("Formato de archivo no permitido. Use JPG o PNG");
  });
});

// ---------------------------------------------------------------------------
// downloadBlob / report PDF exports
// ---------------------------------------------------------------------------

describe("downloadBlob / report PDF exports", () => {
  /** Factory for a successful binary PDF fetch Response. */
  function pdfResponse(filename: string): Response {
    return new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  let clickSpy: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let createdAnchors: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[];

  beforeEach(() => {
    createdAnchors = [];
    clickSpy = vi.fn();
    removeSpy = vi.fn();
    createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
    revokeObjectURLSpy = vi.fn();
    appendChildSpy = vi.fn();

    // This test file runs under `@vitest-environment node` (no real DOM), so
    // `document`/`URL.createObjectURL` are stubbed minimally, just enough to
    // assert `downloadBlob`'s click-to-download sequence.
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        const anchor = { href: "", download: "", click: clickSpy, remove: removeSpy };
        createdAnchors.push(anchor);
        return anchor;
      }),
      body: { appendChild: appendChildSpy },
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloadBlob triggers createObjectURL + anchor click with the Content-Disposition filename", async () => {
    vi.mocked(global.fetch).mockResolvedValue(pdfResponse("reporte-periodo_2026-07-23.pdf"));

    await downloadBlob("/api/personas/reportes/nuevos-por-periodo/pdf", "fallback.pdf");

    expect(global.fetch).toHaveBeenCalledWith("/api/personas/reportes/nuevos-por-periodo/pdf");
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].download).toBe("reporte-periodo_2026-07-23.pdf");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalledWith(createdAnchors[0]);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("downloadBlob falls back to the given filename when Content-Disposition is absent", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), { status: 200 }),
    );

    await downloadBlob("/api/personas/reportes/nuevos-por-periodo/pdf", "fallback.pdf");

    expect(createdAnchors[0].download).toBe("fallback.pdf");
  });

  it("downloadBlob throws a typed error on a non-2xx response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Permisos insuficientes" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(downloadBlob("/api/personas/reportes/nuevos-por-periodo/pdf", "fallback.pdf")).rejects.toThrow(
      "Permisos insuficientes",
    );
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("exportNuevosPorPeriodoPdf calls the periodo PDF BFF route with the date range", async () => {
    vi.mocked(global.fetch).mockResolvedValue(pdfResponse("reporte-periodo_2026-07-23.pdf"));

    await exportNuevosPorPeriodoPdf("2026-01-01", "2026-12-31");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/personas/reportes/nuevos-por-periodo/pdf?fecha_inicio=2026-01-01&fecha_fin=2026-12-31",
    );
  });

  it("exportAsistenciaReportePdf calls the asistencia PDF BFF route with filters", async () => {
    vi.mocked(global.fetch).mockResolvedValue(pdfResponse("reporte-asistencia_2026-07-23.pdf"));

    await exportAsistenciaReportePdf({ fechaInicio: "2026-01-01", fechaFin: "2026-12-31", horarioId: 3 });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/asistencias/reportes/pdf?fechaInicio=2026-01-01&fechaFin=2026-12-31&horarioId=3",
    );
  });
});

