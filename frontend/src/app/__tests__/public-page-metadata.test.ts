import { describe, it, expect, vi } from "vitest";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "", className: "" }) }));
vi.mock("../landing/LandingPage", () => ({ default: () => null }));
vi.mock("../landing/landing.css", () => ({}));
vi.mock("../terminos/LegalDocumentPage", () => ({ default: () => null }));

import { metadata as landing } from "../page";
import { metadata as terminos } from "../terminos/page";

const PAGES = { "/": landing, "/terminos": terminos };

describe("public pages", () => {
  it.each(Object.entries(PAGES))("%s declares its canonical path", (path, metadata) => {
    expect(metadata.alternates?.canonical).toBe(path);
  });

  it.each(Object.entries(PAGES))("%s shares the Spanish es_EC logo card", (_path, metadata) => {
    expect(metadata.openGraph?.locale).toBe("es_EC");
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("og-cata-club-1200x630.png");
  });
});
