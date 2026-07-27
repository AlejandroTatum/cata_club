/**
 * Route Handler Tests — POST /api/personas/admin/cuentas
 *
 * The handler keeps its own allow-list of account types, so it can silently
 * reject a type the backend accepts. These cases pin the list to the backend's
 * Literal in `admin_cuenta_schemas.py`.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${header}.${base64Url(JSON.stringify({ sub: "1", exp }))}.sig`;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/personas/admin/cuentas", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`,
    },
    body: JSON.stringify(body),
  });
}

function validBody(tipoCuenta: string): Record<string, unknown> {
  return {
    tipo_cuenta: tipoCuenta,
    nombres: "Carla",
    apellidos: "Ramirez",
    cedula: "1712345678",
    fecha_nacimiento: "1990-04-12",
    telefono: "0991234567",
    correo: "carla@cataclub.test",
    contrasenia: "clave12345",
  };
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ persona_id: 7 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/admin/cuentas — accepted account types", () => {
  it.each(["JUGADOR", "REPRESENTANTE", "ENTRENADOR"])("forwards %s to the backend", async (tipo) => {
    const response = await POST(postRequest(validBody(tipo)));

    expect(response.status).toBe(201);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ tipo_cuenta: tipo });
  });

  it("rejects an account type the backend does not know", async () => {
    const response = await POST(postRequest(validBody("ARBITRO")));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not demand a legal guardian from a trainer", async () => {
    const response = await POST(postRequest(validBody("ENTRENADOR")));

    expect(response.status).toBe(201);
  });

  it("still demands a legal guardian from a minor", async () => {
    const response = await POST(postRequest(validBody("MENOR")));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
