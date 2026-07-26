/**
 * `/student/enroll` is a public, shareable page (every landing-page
 * enrollment CTA lands on it), but page.tsx is a client component and cannot
 * export `metadata` itself — hence the sibling layout.
 *
 * Without an absolute title the root layout's `%s | Cata Club Admin` template
 * brands the tab and the link preview as an internal admin panel. Same reason
 * src/app/page.tsx uses `title.absolute`.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/student/enroll/layout";

describe("enroll layout metadata", () => {
  it("sets an absolute, non-admin title", () => {
    expect(metadata.title).toEqual({ absolute: "Inscripción — Cata Club" });
  });

  it("describes the enrollment flow", () => {
    expect(metadata.description).toMatch(/inscrip/i);
  });
});
