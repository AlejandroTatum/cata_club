/**
 * The three trigger skins of the Pagos dialog, in one place.
 *
 * Every action in the dialog (register a payment, regularise a debt, suspend,
 * change plan, assign a benefit) used to draw its own trigger — a pink 40px box,
 * grey 28px chips, a red-tinted chip — so nothing said which one mattered. Now
 * they are all the same `md` height and full width of their tile, and only the
 * skin carries meaning: ONE red primary for the task the dialog is open for,
 * `secondary` for the rest, and `secondary` + `text-state-bad` for the action
 * that takes something away (there is no danger variant in `ui/Button`).
 */

import { buttonClasses } from "@/components/ui";

const FULL = "w-full justify-start";

export const PRIMARY_ACTION_TRIGGER = buttonClasses("primary", "md", FULL);
export const ACTION_TRIGGER = buttonClasses("secondary", "md", FULL);
export const DESTRUCTIVE_ACTION_TRIGGER = buttonClasses("secondary", "md", `${FULL} text-state-bad`);
