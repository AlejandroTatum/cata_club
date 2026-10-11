/**
 * #1653 — the refresh token rotates on every use, so every helper that carries
 * a refreshed access token out of `backendFetchAuthed` must carry the rotated
 * refresh token with it, taken from the SAME backend response. Dropping it
 * strands the browser with a refresh cookie that stops working after the grace
 * window.
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/backend-client", () => ({ backendFetchAuthed: vi.fn() }));

import { backendFetchAuthed } from "@/lib/server/backend-client";
import { pickRefreshed } from "@/lib/server/auth";
import { fetchAllPages } from "@/lib/server/paged-fetch";
import { requireAdmin } from "@/lib/server/require-admin";
import { enrichSinglePago } from "@/lib/server/payments-adapter";

const request = {} as NextRequest;
const fetchAuthed = vi.mocked(backendFetchAuthed);

function ok(body: unknown, refreshed?: { access: string; refresh?: string }) {
  return {
    ok: true as const,
    response: new Response(JSON.stringify(body), { status: 200 }),
    refreshedAccessToken: refreshed?.access,
    refreshedRefreshToken: refreshed?.refresh,
  };
}

beforeEach(() => {
  fetchAuthed.mockReset();
});

describe("pickRefreshed", () => {
  it("returns the pair of the first source that refreshed, never mixing sources", () => {
    expect(
      pickRefreshed(
        undefined,
        false,
        { refreshedAccessToken: undefined, refreshedRefreshToken: "orphan" },
        { refreshedAccessToken: "a2", refreshedRefreshToken: "r2" },
        { refreshedAccessToken: "a3", refreshedRefreshToken: "r3" },
      ),
    ).toEqual({ refreshedAccessToken: "a2", refreshedRefreshToken: "r2" });
  });

  it("returns an empty pair when nothing refreshed", () => {
    expect(pickRefreshed(undefined, false, null, {})).toEqual({});
  });

  it("keeps an old backend's access-only refresh without inventing a refresh token", () => {
    expect(pickRefreshed({ refreshedAccessToken: "a1" })).toEqual({ refreshedAccessToken: "a1", refreshedRefreshToken: undefined });
  });
});

describe("fetchAllPages", () => {
  it("forwards the rotated refresh token together with the access token", async () => {
    fetchAuthed.mockResolvedValueOnce(ok({ items: [1], total: 1 }, { access: "a1", refresh: "r1" }));
    const result = await fetchAllPages<number>(request, "/x", 50);
    expect(result).toMatchObject({ ok: true, items: [1], refreshedAccessToken: "a1", refreshedRefreshToken: "r1" });
  });

  it("keeps the last page's pair across pages", async () => {
    fetchAuthed
      .mockResolvedValueOnce(ok({ items: [1, 2], total: 3 }, { access: "a1", refresh: "r1" }))
      .mockResolvedValueOnce(ok({ items: [3], total: 3 }, { access: "a2", refresh: "r2" }));
    const result = await fetchAllPages<number>(request, "/x", 2);
    expect(result).toMatchObject({ ok: true, refreshedAccessToken: "a2", refreshedRefreshToken: "r2" });
  });

  it("does not report a refresh when no page refreshed", async () => {
    fetchAuthed.mockResolvedValueOnce(ok({ items: [1], total: 1 }));
    const result = await fetchAllPages<number>(request, "/x", 50);
    expect(result.ok && result.refreshedAccessToken).toBeFalsy();
    expect(result.ok && result.refreshedRefreshToken).toBeFalsy();
  });
});

describe("requireAdmin", () => {
  it("forwards the rotated refresh token of the /auth/me call", async () => {
    fetchAuthed.mockResolvedValueOnce(ok({ roles: ["ADMINISTRADOR"] }, { access: "a1", refresh: "r1" }));
    expect(await requireAdmin(request)).toEqual({ ok: true, refreshedAccessToken: "a1", refreshedRefreshToken: "r1" });
  });

  it("still rejects a non-admin with 403", async () => {
    fetchAuthed.mockResolvedValueOnce(ok({ roles: ["ESTUDIANTE"] }, { access: "a1", refresh: "r1" }));
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("enrichSinglePago", () => {
  it("forwards the pair of the lookup that refreshed", async () => {
    fetchAuthed
      .mockResolvedValueOnce(ok({ nombres: "Ana", apellidos: "Paz" }))
      .mockResolvedValueOnce(ok({ estado: "ACTIVA", tipoMembresiaId: 1 }, { access: "a2", refresh: "r2" }))
      .mockResolvedValueOnce(ok([]));
    const pago = { personaId: 1, membresiaId: 2 } as unknown as Parameters<typeof enrichSinglePago>[1];
    const enriched = await enrichSinglePago(request, pago);
    expect(enriched.refreshedAccessToken).toBe("a2");
    expect(enriched.refreshedRefreshToken).toBe("r2");
  });
});
