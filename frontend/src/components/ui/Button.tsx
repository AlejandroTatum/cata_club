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

export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost";
export type ButtonSize = "md" | "sm";

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

const SIZE: Record<ButtonSize, string> = {
  md: "h-ctl rounded-ctl px-4 text-[13px]",
  sm: "h-ctl-sm rounded-lg px-3 text-[12.5px]",
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
  // `.btn.ghost` — no chrome at all. A translucent ink wash rather than a
  // fixed grey, because a ghost button is the one control that has no surface
  // of its own and can therefore sit on any of the three.
  ghost: "bg-transparent border-transparent text-ink-2 hover:bg-coal/[0.06] hover:text-ink",
};

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
