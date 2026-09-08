/** Legacy admin account route metadata tests. */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/admin/crear-cuenta/layout";

describe("legacy account route metadata", () => {
  it("names the safe admin destination", () => {
    expect(metadata.title).toEqual("Miembros");
  });
});
