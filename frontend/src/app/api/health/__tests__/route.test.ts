/**
 * Route Handler Tests — GET /api/health
 *
 * Container liveness probe for the Next.js standalone server. Mirrors the
 * rationale of the backend's own /health (backend/main.py): it answers "is
 * this process serving HTTP?", NOT "are its downstream dependencies up?".
 * A probe that fans out to FastAPI would restart a perfectly healthy
 * frontend every time the backend hiccups, so the no-fetch assertion below
 * is a contract, not a detail.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic } from "../route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responds 200 with a JSON status body", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("has no downstream dependency: never calls fetch", async () => {
    await GET();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("opts out of prerendering so the standalone build serves it at runtime", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
