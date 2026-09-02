/**
 * Accordion — a labelled group of question/answer disclosures, at most one
 * open at a time.
 *
 * Written for #203 (`/ayuda`'s FAQ sections), but kept generic — any screen
 * that needs "compact title, expand for detail" is a caller, not a reason to
 * fork this file.
 *
 * ## The two ways this pattern usually breaks
 *
 * 1. A trigger built from `<div onClick>` has no keyboard path and no
 *    assistive-tech semantics — nothing tells a screen reader it toggles
 *    anything. The trigger here is a real `<button>`, so Enter/Space
 *    activation and focusability come from the browser, not from this file.
 * 2. Hiding the panel with CSS alone (`opacity-0`, `max-h-0`) still leaves its
 *    content in the tab order: a keyboard user tabs straight into a link
 *    nobody can see and loses their place. The panel is hidden with the
 *    native `hidden` attribute instead, which drops it from both the
 *    accessibility tree and the tab order — not a class this component could
 *    forget to add.
 *
 * `aria-expanded` on the trigger is the semantic state; the chevron's
 * rotation is the visible one. Neither stands in for the other, so the state
 * is never carried by color alone.
 */

import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import { cn } from "./cn";

export interface AccordionItem {
  /** Stable identifier, used to derive the trigger/panel id pair. */
  id: string;
  question: string;
  answer: ReactNode;
}

export interface AccordionProps {
  items: AccordionItem[];
  /**
   * Prefix for every trigger/panel id this instance renders, so two
   * accordions on the same page never collide (e.g. the section slug).
   */
  idPrefix: string;
  /** Accessible name for the group, e.g. the section title it belongs to. */
  label: string;
  className?: string;
}

export default function Accordion({ items, idPrefix, label, className }: AccordionProps): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div role="group" aria-label={label} className={cn("flex flex-col divide-y divide-line", className)}>
      {items.map((item) => {
        const isOpen = item.id === openId;
        const triggerId = `${idPrefix}-${item.id}-trigger`;
        const panelId = `${idPrefix}-${item.id}-panel`;

        return (
          <div key={item.id} className="py-3 first:pt-0 last:pb-0">
            <h3 className="m-0">
              <button
                type="button"
                id={triggerId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                // `MIN_TARGET_CLASS` (issue #818, WCAG 2.5.8 AA): the trigger
                // is already full width, but measured only 20.3px tall.
                className={cn(
                  "flex w-full items-center justify-between gap-3 text-left text-sm font-bold text-ink",
                  MIN_TARGET_CLASS,
                )}
              >
                <span>{item.question}</span>
                <ChevronDown
                  size={ICON.sm}
                  strokeWidth={2}
                  aria-hidden="true"
                  className={cn(
                    "flex-none text-ink-3 transition-transform duration-200",
                    isOpen && "rotate-180 text-ink",
                  )}
                />
              </button>
            </h3>
            <div id={panelId} hidden={!isOpen} className="mt-2 text-xs leading-prose text-ink-2">
              {item.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
