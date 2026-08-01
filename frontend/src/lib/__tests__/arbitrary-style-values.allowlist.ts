/**
 * The frozen inventory of arbitrary style values — the allowlist behind
 * `arbitrary-style-values.test.ts`.
 *
 * Every entry is an arbitrary value that ALREADY existed under
 * `frontend/src/` the day the lock was installed. These are not approved
 * values; they are measured debt. The lock is green on day one precisely
 * because this list covers all of them, and each migration issue shrinks it.
 *
 * ## How the list shrinks
 *
 * 1. Migrate the uses of one value to the token that replaces it.
 * 2. Delete that line from this file.
 * 3. Run `pnpm test`. Any use left behind is reported with its file and the
 *    token it should be using.
 *
 * Entries are never added. A new entry is exactly what the lock exists to
 * prevent — if a genuinely new value is unavoidable, it gets a name in
 * `tailwind.config.ts` first and stops being arbitrary.
 *
 * `weight` is the one exception, and it is a different kind of list: not debt
 * that shrinks to nothing, but the closed set of `font-*` weights the product
 * may write. It is documented on its own entry below. `icon` and `rhythm` are
 * a third kind again: their rules invert, so they read no list at all.
 *
 * Six of the seven axes are now empty, and three of those six (`icon`,
 * `shadow`, `breakpoint`) no longer consult this file at all: their rules
 * inverted, so there is no list for an entry to come back into.
 *
 * Full protocol: `docs/ux/candado-valores-arbitrarios.md`.
 */

/** The eight axes the lock watches. */
export type Axis =
  | "typography"
  | "leading"
  | "tracking"
  | "weight"
  | "icon"
  | "rhythm"
  | "shadow"
  | "breakpoint";

/**
 * Tolerated values per axis, spelled exactly as they appear in the code: the
 * text between the brackets, or the bare number between the braces for `size`.
 *
 * Frozen from `frontend/src/` on 2026-08-01. Sorted by value, not by how many
 * call sites use it — occurrence counts go stale, and the lock reports the
 * live ones anyway.
 */
export const ALLOWLIST: Record<Axis, readonly string[]> = {
  /**
   * `text-[…]`. Empty. The twenty-five hand-picked sizes are all gone.
   *
   * The display band — 18 · 20 · 24 · 26 · 27 · 30 · 32 · 40 · 42 · 46 · 56 —
   * went first: every call site at 18px and above names a step.
   *
   * The body band went next. `13`, `13.5` and `14` collapsed into `sm`
   * (13.5px), and `14.5`, `15` and `17` into `base` (15px): six sizes, 145
   * call sites, one half-pixel cluster less.
   *
   * The dense band followed: `12` and `12.5` collapsed into `xs` (12.5px)
   * across 74 call sites — the single largest cluster of the inventory.
   *
   * The micro band closed it: `9`, `9.5`, `10`, `10.5`, `11` and `11.5` all
   * collapsed into `2xs` (10.5px) across 91 call sites. A step is now the only
   * way to write a font size.
   */
  typography: [],

  /**
   * `leading-[…]`. Empty. Line-height travels with the size step.
   *
   * `1.12` and `1.15` retired with the display band: both were headline
   * line-heights, and `leading-crisp` (1.15) is the step that names them.
   *
   * `1.35` retired with the body band. Its single call site was the toast
   * message, which now takes the 1.5 that `sm` brings.
   *
   * `1.45` retired with the dense band, and so did one of the two `1.5` call
   * sites: the hint box, the toast body and the help escape hatch sit within
   * 0.05 of the 1.5 that `xs` already carries — under a pixel at 12.5px — so
   * they were dropped instead of renamed. The other two kept their value
   * under a name, because a step exists for each case: `1.55` on the FAQ
   * answer is `leading-prose`, and `1.25` on the brand label is
   * `leading-tight`, a factory step that is exactly 1.25.
   *
   * The last three went with the micro band. `1.2` and `1.3` are the two
   * stacked labels of the member card, whose sibling value already rides
   * `leading-tight` (1.25) — they now ride it too, within 0.13px of what they
   * measured. `1.5` was the auth small print, 0.1 from the 1.4 that `2xs`
   * carries, so it was dropped like the other sub-pixel overrides.
   */
  leading: [],

  /**
   * `tracking-[…]`. Empty. Letter-spacing travels with the size step too.
   *
   * The three `px` trackings are gone — they were the ones that could not
   * scale with the type, and all three lived in `AuthShell.tsx`. Two were
   * covered by the tracking a size step already carries and simply vanished;
   * `2px` on a 10px uppercase run is 0.2em, which is `tracking-caps-wide`.
   *
   * `-0.05em`, `-0.04em` and `-0.03em` retired the same way: they are the
   * defaults of `display`, `2xl` and `xl`, and every call site that spelled
   * them out now sits on the step that brings them.
   *
   * `-0.015em` and `-0.02em` retired with the body band. The four `-0.015em`
   * call sites sat 0.005em from the tracking `base` already carries and were
   * dropped; the single `-0.02em` had to keep tightening a tabular figure, so
   * it names `tracking-dense` instead.
   *
   * `0.06em` retired with the dense band. Its single call site is the toast
   * action label, an uppercase run that would close up on the 0em `xs`
   * carries, so it names `tracking-wider` (0.05em) instead of being dropped.
   *
   * The micro band retired the last five. `0.1em`, `0.12em` and `0.13em` were
   * forty-one uppercase micro-labels spread across 0.03em — the exact cluster
   * `2xs`'s own 0.12em exists to end, so the class simply disappears from all
   * of them. `0.2em` on the auth eyebrow does contradict the step and names
   * `tracking-caps-wide`. `-0.01em` on the stat-card unit sat 0.005em from
   * what `sm` carries and was dropped, like the `-0.015em` cluster before it.
   */
  tracking: [],

  /**
   * `font-…`. The ONE axis of this file that is not measured debt.
   *
   * The other six list values that already existed and that each migration
   * deletes until the list is empty. This one lists the weights the product
   * is allowed to write, and it is meant to stay exactly this long: Tailwind
   * ships nine weight classes as factory utilities, so there is no arbitrary
   * value to catch — the drift is writing a tenth of a scale that only has
   * four rungs.
   *
   * `_sistema.css` declares `font-weight` fifty-one times and spends it on
   * five values, but not evenly: 700 thirty-two times, 600 twenty, 800
   * sixteen — and 500 and 400 exactly once each. `500` is `.nav-i` (:140),
   * whose active state is the only place in the system where the weight
   * carries meaning, and it carries it alongside four louder channels. `400`
   * is `.hint` (:167).
   *
   * So `medium` had one line of authority and ninety-one call sites. It is
   * gone. `extrabold` has sixteen — every headline, every stat figure, every
   * hero number — and it stays.
   *
   * `normal` stays too, and is not a fourth rung: all seven call sites undo
   * an inherited weight (a note inside a `font-semibold` row, the toast's
   * supporting line inside a `font-semibold` fill), which is what 400 does
   * in `.hint` as well.
   *
   * The five that are absent — `thin`, `extralight`, `light`, `medium`,
   * `black` — have never had a call site the system asked for.
   */
  weight: ["normal", "semibold", "bold", "extrabold"],

  /**
   * `size={…}` on a lucide icon. Empty. An icon size is a step of the `ICON`
   * scale in `lib/icon-size.ts`, and nothing else.
   *
   * The fourteen sizes — 10 · 11 · 12 · 13 · 14 · 15 · 16 · 17 · 18 · 19 · 20
   * · 21 · 24 · 32 — collapsed into three across 262 call sites in 43 files.
   * Ten of the fourteen lived between 10 and 21: eleven pixels of range cut
   * into ten steps, which is the same half-pixel clustering the type scale
   * found, on the axis that sits right next to the text.
   *
   * The three that replace them are `text-xs`, `text-base` and `text-lg`
   * multiplied by 1.2 — the ratio `_sistema.css` already spends on `.srch`
   * (12.5px text, 15px icon), `.btn` (13/15) and `.nav-i` (13.5/17).
   *
   * This entry is empty AND the axis no longer reads an allowlist: the rule
   * inverted in the same pass, so `size={16}` and `size={anythingElse}` both
   * fail on any file that imports `lucide-react`. It is the icon equivalent of
   * what the weight axis did for `font-medium` — the entry cannot come back,
   * because there is no longer a list for it to come back into.
   */
  icon: [],

  /**
   * `space-y-…` and `gap-y-…` inside a screen. Empty, and — like `icon` — the
   * axis does not read this list at all.
   *
   * #31 found FIVE idioms for the vertical rhythm of a page (`mb-*` on each
   * block, `flex flex-col gap-5`, `mt-4 flex flex-col gap-4`,
   * `w-full space-y-5`, and no wrapper at all) across the same fourteen
   * screens the same shell draws. The drift was never about which number: it
   * was that five different forms all produced "some separation".
   *
   * So the rule constrains the FORM, the way the icon axis does. In a module
   * that renders `<AppShell>`, the two families that do nothing but vertical
   * rhythm must name a step of the scale — `page` (20px), `section` (14px),
   * `field` (7px) — or `0`, which is an explicit reset. There is no list for
   * an entry to come back into.
   *
   * `gap-*` unqualified is deliberately out: on a row it is horizontal, and
   * this axis would be guessing. `docs/ux/ritmo-vertical.md` has the argument.
   */
  rhythm: [],

  /**
   * `shadow-…`. Empty, and — like `icon` — the axis no longer reads a list.
   *
   * The ten arbitrary elevations are gone. Five were not elevations at all:
   * they were the focus indicator, drawn with `box-shadow` because an
   * `outline` cannot be two colours. `focus-ring-usage.test.ts` REQUIRES that
   * pair on every `outline-ball`, so retiring them meant moving them into the
   * theme — `shadow-focus-band`, `shadow-focus-band-inset`, `shadow-focus-duo`
   * and `shadow-focus-duo-float` — and teaching that guard to look for the
   * token instead of for a hex it can no longer find. Nothing was dropped.
   *
   * Of the other five, two were the same card standing alone on the canvas,
   * one on each side of the `0 8px 34px …/.07` that `_sistema.css` declares
   * for it (`.authcard`, line 394): both are `shadow-hero` now. The chat panel
   * collapsed into `shadow-elevated`, which is the rung the config reserves
   * for things floating over the page — that one DID have prototype backing
   * (`.chat`, line 417), and it is the cost of the collapse, the same trade
   * #30 documented. The launcher's resting shadow named itself `shadow-float`,
   * because a 16% coal shadow under a near-black disc is invisible. And the
   * disc on the auth panel simply lost its 50%-black pool: neither prototype
   * ever drew one.
   *
   * The rule inverted in the same pass. A bracket was never the only way to
   * miss the ladder — `shadow-md` is a factory class and it was in the
   * codebase, so the emptied list would have shrugged at it exactly the way
   * the emptied icon list would have shrugged at `size={iconSize}`. The rule
   * now reads `tailwind.config.ts` itself: any `shadow-…` that is not a key of
   * its `boxShadow` map fails, brackets or not.
   */
  shadow: [],

  /**
   * `min-[…]` / `max-[…]`. Empty, and this axis reads no list either.
   *
   * There was exactly one value — `980px`, fifteen call sites, every one of
   * them in `components/auth/AuthShell.tsx`, not "the admin shell" as this
   * line used to claim. It is now the `split` screen of `tailwind.config.ts`.
   *
   * A named prefix cannot be written between brackets, so there is nothing an
   * exemption would have to let through: every match of the pattern is a
   * violation, always. `max-[…]` joined the pattern at the same time — it is
   * the same magic number wearing the other operator, and an empty `min-[…]`
   * list would not have said a word about it.
   */
  breakpoint: [],
};
