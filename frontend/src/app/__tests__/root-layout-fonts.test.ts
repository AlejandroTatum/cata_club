/**
 * The app fonts are Switzer (sans) and Anybody (display), with Playfair kept as
 * the serif voice. The root layout puts the CSS variables from `lib/fonts.ts`
 * on `<html>`, and the Tailwind stacks must start with those same variables, or
 * the family resolves to nothing.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Anybody: () => ({ variable: "--font-anybody" }),
}));
vi.mock("next/font/local", () => ({
  default: (options: { variable: string }) => ({ variable: options.variable }),
}));

import { fontVariables } from "@/lib/fonts";
import tailwindConfig from "../../../tailwind.config";

describe("root layout font variables", () => {
  it("exposes Switzer, Anybody and Playfair, and no longer Barlow or Graduate", () => {
    expect(fontVariables.split(" ")).toEqual([
      "--font-switzer",
      "--font-anybody",
      "--font-playfair",
    ]);
  });

  it("starts each Tailwind family stack with the matching variable", () => {
    const fontFamily = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]>;
    expect(fontFamily.sans[0]).toBe("var(--font-switzer)");
    expect(fontFamily.display[0]).toBe("var(--font-anybody)");
    expect(fontFamily.serif[0]).toBe("var(--font-playfair)");
  });
});
