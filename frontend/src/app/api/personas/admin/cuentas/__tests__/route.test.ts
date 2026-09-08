/**
 * The legacy BFF route must not proxy admin account creation.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import * as route from "../route";

describe("legacy admin account BFF route", () => {
  it("has no POST proxy", () => {
    const legacyRoute: Record<string, unknown> = route;
    expect(legacyRoute.POST).toBeUndefined();
  });

  it("returns not found for direct GET requests", () => {
    const response = route.GET();

    expect(response.status).toBe(404);
  });
});
