/**
 * WCAG 2.1 relative luminance and contrast ratio.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * These four functions are the measuring instrument every colour guard in the
 * repo reads through — `color-contrast.test.ts` for the app's tokens,
 * `prototipos-sistema-tokens.test.ts` for the prototype sheet. They live in a
 * plain module rather than inside one of those test files because importing a
 * test file re-registers its `describe` blocks into the importer, so the two
 * suites would run each other's assertions and a failure in one would surface
 * as a red run in the other. One formula, one place, no drift.
 */

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(parseHex(foreground)),
    relativeLuminance(parseHex(background)),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composite a translucent foreground over an opaque background (Tailwind's `/nn`). */
export function compositeOver(foreground: string, background: string, alpha: number): string {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  return `#${fg
    .map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Perceptual lightness, for reasoning about surface steps rather than text. */
export function lightness(hex: string): number {
  const y = relativeLuminance(parseHex(hex));
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
