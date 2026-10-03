import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateMetadata } from "../layout";

vi.mock("@/lib/fonts", () => ({ fontVariables: "" }));
vi.mock("@/components/Header", () => ({ default: () => null }));
vi.mock("@/components/AuthProviderWrapper", () => ({ default: () => null }));
vi.mock("@/components/ToastContainer", () => ({ default: () => null }));
vi.mock("@/contexts/ToastContext", () => ({ ToastProvider: () => null }));

const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(path.join(PUBLIC_DIR, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoSizes(file: string): number[] {
  const bytes = readFileSync(path.join(PUBLIC_DIR, file));
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => bytes[6 + index * 16] || 256);
}

describe("brand icons", () => {
  it("favicon.ico carries square 16, 32 and 48 images", () => {
    expect(icoSizes("favicon.ico").sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it.each([48, 96, 192, 512])("icon-%i.png is exactly square at that size", (size) => {
    expect(pngSize(`brand/icons/icon-${size}.png`)).toEqual({ width: size, height: size });
  });

  it("apple touch icon is 180x180", () => {
    expect(pngSize("brand/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("the social card is 1200x630", () => {
    expect(pngSize("brand/og-cata-club-1200x630.png")).toEqual({ width: 1200, height: 630 });
  });

  it("the structured-data logo is square and at least 112px", () => {
    const { width, height } = pngSize("brand/cata-club-logo-square-512.png");
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(112);
  });
});

describe("root layout icon declaration", () => {
  it("declares the square crest icons and never the non-square logo", () => {
    const icons = generateMetadata().icons as { icon: { url: string }[]; apple: { url: string }[] };
    const urls = icons.icon.map((entry) => entry.url);
    expect(urls).toContain("/favicon.ico");
    expect(urls).toContain("/brand/icons/icon-48.png");
    expect(urls).toContain("/brand/icons/icon-192.png");
    expect(urls.some((url) => url.includes("cata-club-logo.jpeg"))).toBe(false);
    expect(icons.apple[0].url).toBe("/brand/icons/apple-touch-icon.png");
  });
});

describe("root layout social metadata", () => {
  it("shares the 1200x630 logo card and defaults to noindex", () => {
    const metadata = generateMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph?.locale).toBe("es_EC");
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("/brand/og-cata-club-1200x630.png");
    expect((metadata.twitter as { card: string }).card).toBe("summary_large_image");
  });
});
