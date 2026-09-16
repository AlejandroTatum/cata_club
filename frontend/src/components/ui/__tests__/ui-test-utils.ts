/**
 * Shared helpers for the UI-primitive tests.
 *
 * `expect(el).toHaveClass("h-ctl")` only proves a string is present. These
 * helpers resolve the class back through `tailwind.config.ts` so the assertion
 * is about the committed PIXEL value — the thing `_sistema.css` actually
 * specifies. Rename or retune a token and the component tests fail, which is
 * the point.
 */

import tailwindConfig from "../../../../tailwind.config";

type Scale = Record<string, string>;

const extend = tailwindConfig.theme?.extend ?? {};

export const HEIGHT_TOKENS = (extend.height ?? {}) as Scale;
export const MIN_HEIGHT_TOKENS = (extend.minHeight ?? {}) as Scale;
export const RADIUS_TOKENS = (extend.borderRadius ?? {}) as Scale;
export const COLOR_TOKENS = (extend.colors ?? {}) as Record<string, unknown>;

/** The pixel height the element's `h-*` token commits to, if it wears one. */
export function committedHeight(element: Element): string | undefined {
  for (const className of Array.from(element.classList)) {
    if (!className.startsWith("h-")) continue;
    const value = HEIGHT_TOKENS[className.slice(2)];
    if (value) return value;
  }
  return undefined;
}

/**
 * The pixel FLOOR the element's `min-h-*` token commits to, if it wears one —
 * distinct from `committedHeight`, which reads a fixed `h-*` token: content
 * inside a `min-h-*` box is free to grow past this number.
 */
export function committedMinHeight(element: Element): string | undefined {
  for (const className of Array.from(element.classList)) {
    if (!className.startsWith("min-h-")) continue;
    const value = MIN_HEIGHT_TOKENS[className.slice("min-h-".length)];
    if (value) return value;
  }
  return undefined;
}

/** The pixel radius the element's `rounded-*` token commits to, if any. */
export function committedRadius(element: Element): string | undefined {
  for (const className of Array.from(element.classList)) {
    if (!className.startsWith("rounded-")) continue;
    const value = RADIUS_TOKENS[className.slice("rounded-".length)];
    if (value) return value;
  }
  return undefined;
}
