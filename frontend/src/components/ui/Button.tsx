/**
 * Button — the single control height in the system.
 *
 * `_sistema.css` `.btn` (:167-176): 40px tall (`--h-ctl`), 16px horizontal
 * padding, 10px radius (`--r-ctl`), 13px/600 label. `.btn.sm` (:173) is the
 * in-table action: 32px (`--h-ctl-sm`), 12px padding, 12.5px label, 8px radius.
 *
 * Why this exists: the legacy `.btn-primary` in `globals.css` is nominally
 * `px-5 py-2.5`, but callers override the padding and it ships at four
 * different real heights. Here the height is a token, not a caller decision.
 *
 * Color rule (non-negotiable): red is reserved for the PRIMARY CTA and for
 * destructive/error actions. A selected or active state is never red — it is
 * coal plus the yellow ball dot (see `FilterPill`).
 */

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "./cn";

/**
 * The levels and the sizes, as VALUES — and the types are derived from them,
 * not the other way round.
 *
 * A union type has no runtime members, so anything that needs to walk "every
 * variant" has to retype the list, and `Button.test.tsx` did exactly that in
 * two places. Both lists were written before `onCoal` existed and neither grew
 * with it, so the sweep asserting that every variant holds 40px and the sweep
 * asserting that no other variant is red were both silently skipping a fifth
 * of the system. Declaring the array first and reading the type off it makes
 * that drift impossible: a sixth level is in every sweep the moment it is
 * added, or it does not compile.
 */
export const BUTTON_VARIANTS = ["primary", "secondary", "dark", "tertiary", "onCoal"] as const;
export const BUTTON_SIZES = ["md", "sm"] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/** `.btn` base — shape, typography and focus ring, without any color. */
// The focus ring is NOT declared here. `_sistema.css:80` specifies the ball at
// 2px/offset 2px, and this file used to transcribe it literally — but #FFD600
// measures 1.41:1 on `paper` and 1.16:1 on `canvas`, which is where buttons
// actually live. The ball survives as the inner band of the system ring in
// `globals.css`, which dresses every focusable element in the product.
const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold " +
  "transition-colors duration-150 " +
  // `.btn[disabled], .btn.off` (:176)
  "disabled:cursor-not-allowed disabled:opacity-45";

// Both sizes wear the CONTROL radius. `sm` used to carry `rounded-lg` — 8px —
// which was the only third radius in `ui/` and the one DESIGN.md's "dos radios
// y nada más" does not have. Nothing measured it, so every compact in-table
// action in the product sat at 8px beside 10px controls: the shape said "this
// is a slightly different category of thing", which is exactly what the two
// radii exist to say and exactly what is not true here. A compact button is a
// button.
const SIZE: Record<ButtonSize, string> = {
  md: "h-ctl rounded-ctl px-4 text-sm",
  sm: "h-ctl-sm rounded-ctl px-3 text-xs",
};

const VARIANT: Record<ButtonVariant, string> = {
  // `.btn.pri` — the only red button. Hover is `--red-dark`.
  primary: "bg-cata-red border-cata-red text-white hover:bg-cata-red-dark hover:border-cata-red-dark",
  // `.btn` bare — white surface, `--line-2` border. Hover is `sunken`, not
  // `canvas`: a white button standing ON the canvas that hovers TO the canvas
  // dissolves into the page instead of responding.
  secondary: "bg-paper border-line-2 text-ink hover:bg-sunken",
  // `.btn.dark` — coal. Secondary-but-emphatic actions ("+ Nuevo miembro").
  dark: "bg-coal border-coal text-white hover:bg-coal-2 hover:border-coal-2",
  // The third level (D5). It replaces `ghost`, which was `bg-transparent
  // border-transparent` — "no chrome at all" — and was rejected for exactly
  // that: "no me gustan los botones vacíos o sin box".
  //
  // So the third level is distinguished by FILL rather than by absence. The
  // border stays transparent on purpose: three levels that each add a line
  // would differ only in how dark that line is, whereas fill against no fill
  // is a difference you read without comparing. `BASE` declares `border`
  // unconditionally, so a colour has to be named here or the control inherits
  // `currentColor` and grows the outline the fill exists to replace.
  //
  // Hover goes one rung UP the ladder to `line` rather than reaching for a
  // wash: a fixed step is a state you can measure, and it is measured —
  // `color-contrast.test.ts` puts ink-2 at 7.97:1 on `sunken`, 6.54:1 on
  // `line` (the frame mid-transition, where the old label is already over the
  // arriving fill) and ink at 13.26:1 once settled. The fill itself clears the
  // ladder's own 1.09:1 rung on both neighbours it can stand on: 1.098:1 on
  // `paper`, 1.112:1 on `canvas`.
  tertiary: "bg-sunken border-transparent text-ink-2 hover:bg-line hover:text-ink",
  // `.btn.oncoal` (prototype 31) — the secondary action INSIDE a coal card
  // (the trainer dashboard's immediate-session card). `secondary`'s white
  // fill would read as a second block competing with the coal surface it
  // sits on, so this is a translucent outline instead: transparent fill,
  // a white-tinted border, white text — the same language `dark` speaks in
  // reverse, for the one surface that is already coal.
  onCoal: "bg-transparent border-white/25 text-white hover:bg-white/10 hover:border-white/45",
};

/**
 * The COLOURS of a level, without its shape.
 *
 * `buttonClasses` below is the usual door and hands out shape and colour
 * together. This one exists for the control that wants the system's colour
 * recipe on a shape of its own: `BackLink` is a 32px pill at the 10px control
 * radius (D12b), which is neither `md` nor `sm`, but it is the `tertiary`
 * LEVEL and its fill, its label ink and its hover step have to be that level's
 * — not a second set of values that happen to match today.
 *
 * `cn` is a plain joiner with no class-merging, so composing the full
 * `buttonClasses` string and overriding the shape afterwards would ship both
 * heights and let stylesheet order pick one. Taking the colours alone is the
 * honest way to reuse a skin here.
 */
export function buttonSkin(variant: ButtonVariant): string {
  return VARIANT[variant];
}

/**
 * The class string for a given variant/size, exported so anchors and
 * `next/link` can wear the button skin without cloning the values.
 */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, SIZE[size], VARIANT[variant], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Ref-forwarding, because a primitive that cannot hold a ref is a primitive
 * some call sites have to opt out of — `ConfirmDialog`'s focus trap needs to
 * focus its own confirm button, and "this control can't take a ref" is exactly
 * the kind of excuse that grows a fifth bespoke button.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", children, ...rest },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
