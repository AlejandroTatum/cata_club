/**
 * A renamed route still has to answer at its old name.
 *
 * `/ranking` served the Niveles ladder long enough to be shared in messages and
 * kept in bookmarks. The competitive feature it was named after is gone and the
 * concept is called "nivel" now, so the route moved to `/nivel` — but deleting
 * the old one would have traded a naming problem for an availability one, which
 * is a worse trade for the person holding the link.
 *
 * Permanent (308), not temporary: the move is not coming back, and a permanent
 * redirect is what tells a browser and a crawler to stop asking for the old one.
 */

import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config.js";

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
}

const redirects = async (): Promise<Redirect[]> =>
  (await (nextConfig as { redirects: () => Promise<Redirect[]> }).redirects()) ?? [];

describe("route redirects", () => {
  it("keeps /ranking answering, permanently, at the route that names the concept", async () => {
    const ranking = (await redirects()).find((r) => r.source === "/ranking");

    expect(ranking).toBeDefined();
    expect(ranking?.destination).toBe("/nivel");
    expect(ranking?.permanent).toBe(true);
  });

  it("never redirects to a route that no longer exists", async () => {
    // The failure this catches is a second rename that updates the route and
    // forgets the redirect pointing at it, which turns a working old link into
    // a 404 with an extra hop in front of it.
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const appDir = join(__dirname, "..", "..", "app");

    for (const { destination } of await redirects()) {
      const [segment] = destination.split("/").filter(Boolean);
      const target = join(appDir, segment);
      expect(
        statSync(target).isDirectory(),
        `${destination} has no route under src/app`,
      ).toBe(true);
      expect(readdirSync(target)).toContain("page.tsx");
    }
  });
});
