import { describe, it, expect } from "vitest";
import { FAQ_SECTIONS } from "../faq-content";
import { SECTION_ACCENT } from "../section-accent";

describe("/ayuda section accents", () => {
  it("has an accent for every knowledge section, and no stale keys", () => {
    // The page reads SECTION_ACCENT[section.title]; a renamed knowledge title
    // would otherwise only surface as a render-time crash.
    expect(Object.keys(SECTION_ACCENT).sort()).toEqual(
      FAQ_SECTIONS.map((section) => section.title).sort(),
    );
  });
});
