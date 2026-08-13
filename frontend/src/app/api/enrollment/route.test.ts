/**
 * Tests for POST /api/enrollment — the BFF proxy to the backend's public,
 * rate-limited POST /enrollment/.
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Covers: snake_case DTO translation, HttpOnly cookie attributes on
 * auto-login, that tokens never appear in the JSON body, and validation /
 * error passthrough.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BLOOD_TYPES } from "@/types/enrollment";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";
import { POST } from "./route";

const validBody = {
  alumno: { nombres: "Ana", apellidos: "Pérez", cedula: "1712345678", fechaNacimiento: "2000-01-15", telefono: "0991234567" },
  credencialesAlumno: { correo: "ana@example.com", contrasenia: "password8" },
  fichaMedica: { tipoSangre: BLOOD_TYPES.O_POSITIVO, condicionesSalud: "", alergias: "", contactoEmergencia: "María", telefonoEmergencia: "0997654321" },
};

const tokenBody = { access_token: "a", refresh_token: "r", token_type: "bearer", persona_id: 5 };

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function enrollRequest(body: unknown, method = "POST", headers?: HeadersInit): Request {
  return new Request("http://localhost/api/enrollment", {
    method,
    body: method === "POST" ? JSON.stringify(body) : undefined,
    headers,
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/enrollment", () => {
  it("accepts a public complete request without exposing credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    const response = await POST(enrollRequest(validBody));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ enrolled: true });
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain(validBody.alumno.cedula);
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    await POST(enrollRequest(validBody, "POST", { "x-forwarded-for": "198.51.100.5" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/enrollment/");
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.5");
  });

  it("never returns a token in the JSON body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ ...tokenBody, access_token: "super-secret-a", refresh_token: "super-secret-r" }));

    const response = await POST(enrollRequest(validBody));
    const json = await response.json();

    expect(JSON.stringify(json)).not.toMatch(/super-secret/);
    expect(json).toEqual({ enrolled: true });
  });

  it("sets both cookies as HttpOnly, SameSite=Lax on success", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    const response = await POST(enrollRequest(validBody));

    const access = response.cookies.get(ACCESS_TOKEN_COOKIE);
    const refresh = response.cookies.get(REFRESH_TOKEN_COOKIE);
    expect(access?.value).toBe("a");
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(refresh?.value).toBe("r");
    expect(refresh?.httpOnly).toBe(true);
  });

  it("translates the request into the backend's snake_case EnrollmentCreateDTO", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    await POST(enrollRequest(validBody));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/enrollment/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          alumno: { nombres: "Ana", apellidos: "Pérez", cedula: "1712345678", fecha_nacimiento: "2000-01-15", telefono: "0991234567" },
          credenciales_alumno: { correo: "ana@example.com", contrasenia: "password8" },
          ficha_medica: { tipo_sangre: "O_POSITIVO", enfermedades: [], contacto_emergencia: "María", telefono_emergencia: "0997654321" },
        }),
      }),
    );
  });

  it("rejects an incomplete body without calling the backend", async () => {
    const response = await POST(enrollRequest({}));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ detail: expect.any(String) }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through the backend's validation error status and message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Ya existe una persona con la cédula 1712345678", message: "Ya existe una persona con la cédula 1712345678" }, 400));

    const response = await POST(enrollRequest(validBody));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.message).toMatch(/cédula/);
  });

  it("passes through a 429 rate-limit response from the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Rate limit exceeded" }, 429));

    const response = await POST(enrollRequest(validBody));

    expect(response.status).toBe(429);
  });

  it("returns 503 (not a raw error) when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(enrollRequest(validBody));

    expect(response.status).toBe(503);
  });

  it("rejects a non-POST request when invoked directly", async () => {
    const response = await POST(enrollRequest(undefined, "GET"));
    expect(response.status).toBe(405);
  });
});

/**
 * `EnrollmentMedicalRecord` declares `condicionesSalud` and `alergias` as
 * required strings (empty allowed) and only `observaciones` as optional. The
 * validator used to accept all three as optional, so a body omitting
 * `condicionesSalud` reached the adapter and crashed on `.split(",")` — a 500
 * where the client deserved a 400.
 */
describe("POST /api/enrollment — fichaMedica field contract", () => {
  function bodyWithFichaMedica(overrides: Record<string, unknown>): unknown {
    return { ...validBody, fichaMedica: { ...validBody.fichaMedica, ...overrides } };
  }

  function bodyWithoutFichaMedicaField(field: string): unknown {
    const fichaMedica: Record<string, unknown> = { ...validBody.fichaMedica };
    delete fichaMedica[field];
    return { ...validBody, fichaMedica };
  }

  it("rejects a fichaMedica without condicionesSalud with 400, not a 500", async () => {
    const response = await POST(enrollRequest(bodyWithoutFichaMedicaField("condicionesSalud")));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ detail: expect.any(String) }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a fichaMedica without alergias with 400", async () => {
    const response = await POST(enrollRequest(bodyWithoutFichaMedicaField("alergias")));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ detail: expect.any(String) }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-string condicionesSalud with 400", async () => {
    for (const invalid of [42, null, ["asma"]]) {
      vi.mocked(global.fetch).mockClear();

      const response = await POST(enrollRequest(bodyWithFichaMedica({ condicionesSalud: invalid })));

      expect(response.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    }
  });

  // An empty condicionesSalud means "no health conditions" — the wizard
  // initialises the textarea to "". Tightening this to a non-empty check would
  // force healthy students to invent a condition, so pin the accepted case.
  it("accepts an empty condicionesSalud as 'no conditions'", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    const response = await POST(enrollRequest(bodyWithFichaMedica({ condicionesSalud: "" })));

    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("accepts an empty alergias", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    const response = await POST(enrollRequest(bodyWithFichaMedica({ alergias: "" })));

    expect(response.status).toBe(201);
  });

  it("accepts a fichaMedica without observaciones, which is genuinely optional", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));

    const response = await POST(enrollRequest(bodyWithoutFichaMedicaField("observaciones")));

    expect(response.status).toBe(201);
  });
});

/**
 * Same drift class as fichaMedica: fields the type declares but the validator
 * never inspected, so a malformed value was forwarded to the backend.
 */
describe("POST /api/enrollment — optional field contract", () => {
  it("rejects a non-number institucionId with 400", async () => {
    const body = { ...validBody, alumno: { ...validBody.alumno, institucionId: "3" } };

    const response = await POST(enrollRequest(body));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts a numeric institucionId", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));
    const body = { ...validBody, alumno: { ...validBody.alumno, institucionId: 3 } };

    const response = await POST(enrollRequest(body));

    expect(response.status).toBe(201);
  });

  it("rejects a malformed credencialesMenor with 400", async () => {
    const body = { ...validBody, credencialesMenor: { correo: "not-an-email", contrasenia: "short" } };

    const response = await POST(enrollRequest(body));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts a well-formed credencialesMenor", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tokenBody));
    const body = { ...validBody, credencialesMenor: { correo: "hijo@example.com", contrasenia: "password8" } };

    const response = await POST(enrollRequest(body));

    expect(response.status).toBe(201);
  });
});
