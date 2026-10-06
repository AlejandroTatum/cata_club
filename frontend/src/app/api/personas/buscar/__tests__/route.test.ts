import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const proxyBackendGet = vi.fn();
vi.mock("@/lib/server/backend-client", () => ({
  proxyBackendGet: (...args: unknown[]) => proxyBackendGet(...args),
}));

import { GET } from "../route";

describe("GET /api/personas/buscar", () => {
  beforeEach(() => {
    proxyBackendGet.mockReset();
    proxyBackendGet.mockResolvedValue(NextResponse.json([]));
  });

  it("forwards the jugador filter to the backend search (#1669)", async () => {
    await GET(new NextRequest("http://localhost/api/personas/buscar?q=Mat&jugador=true&limit=10"));

    expect(proxyBackendGet.mock.calls[0][1]).toBe("/personas/buscar?q=Mat&jugador=true&limit=10");
  });

  it("keeps forwarding rol for callers that need an account", async () => {
    await GET(new NextRequest("http://localhost/api/personas/buscar?q=Mat&rol=ALUMNO"));

    expect(proxyBackendGet.mock.calls[0][1]).toBe("/personas/buscar?q=Mat&rol=ALUMNO");
  });
});
