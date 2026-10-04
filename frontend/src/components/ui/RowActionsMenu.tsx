/**
 * RowActionsMenu — the overflow menu of a list row: one icon button that opens
 * the row's secondary actions.
 *
 * A row keeps ONE primary action visible and moves the rest here, so forty
 * rows do not repeat three buttons each. The trigger's accessible name names
 * the row ("Más acciones para María González") because a page of identical
 * "Más acciones" buttons is unusable with a screen reader.
 *
 * Behaviour is the WAI-ARIA menu-button pattern: the trigger opens the menu
 * (Enter, Space, ArrowDown); ArrowUp/ArrowDown/Home/End move between items;
 * Escape closes and returns focus to the trigger; Tab or a press outside
 * closes. Choosing an item closes the menu and puts focus back on the trigger
 * BEFORE the action runs, so a dialog the action opens restores focus to a
 * control that still exists.
 *
 * The menu is portalled to `document.body` and positioned from the trigger's
 * rectangle: table rows live inside `overflow-x-auto` wrappers, which would
 * clip an absolutely positioned popup on the last rows.
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "./Button";

export interface RowActionsMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface RowActionsMenuProps {
  /** Accessible name of the trigger, e.g. "Más acciones para María González". */
  label: string;
  items: readonly RowActionsMenuItem[];
  /**
   * Visible text for the trigger (e.g. "Más"). Without it the trigger is a
   * bare "⋯" icon that only announces itself on hover, so a list that wants the
   * overflow to read as a control passes one. The accessible name stays `label`.
   */
  triggerLabel?: string;
  /** Icon of a bare trigger, in place of "⋯" (e.g. the pencil on a profile photo). */
  triggerIcon?: ReactNode;
  /** Replaces the trigger's button classes, for a trigger that is not a row control. */
  triggerClassName?: string;
  /**
   * Which trigger edge the menu lines up with. `end` (the default) suits a
   * trigger at a row's right edge; `start` suits one near the left edge, where
   * a right-aligned menu would run off the screen.
   */
  align?: "start" | "end";
}

const MENU_GAP = 4;

export default function RowActionsMenu({
  label,
  items,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  align = "end",
}: RowActionsMenuProps): ReactElement {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  /** Which item takes focus when the menu opens: the first, or the last (ArrowUp). */
  const initialFocus = useRef<"first" | "last">("first");

  const itemButtons = useCallback(
    (): HTMLButtonElement[] =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    [],
  );

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /** Measures the trigger and places the menu under it; false once the trigger is out of view. */
  const place = useCallback((): boolean => {
    if (!triggerRef.current) return false;
    const rect = triggerRef.current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    setPosition(
      align === "start"
        ? { top: rect.bottom + MENU_GAP, left: Math.max(rect.left, MENU_GAP) }
        : { top: rect.bottom + MENU_GAP, right: Math.max(window.innerWidth - rect.right, MENU_GAP) },
    );
    return true;
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open || !position) return;
    const buttons = itemButtons();
    (initialFocus.current === "last" ? buttons[buttons.length - 1] : buttons[0])?.focus({ preventScroll: true });
  }, [open, position, itemButtons]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    // The popup is positioned from the trigger's rectangle, so a scroll or
    // resize re-measures it rather than closing it: touch browsers fire both
    // as a side effect of opening (focus, URL bar, virtual keyboard), and
    // closing there would dismiss the menu before it could be used. It only
    // closes once its row has left the viewport. rAF-throttled: scroll is hot.
    let frame = 0;
    const reposition = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!place()) close(false);
      });
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, close, place]);

  function openWith(which: "first" | "last"): void {
    initialFocus.current = which;
    setOpen(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = itemButtons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = (current + 1) % buttons.length;
        break;
      case "ArrowUp":
        next = (current - 1 + buttons.length) % buttons.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={label}
        className={
          triggerClassName ??
          (triggerLabel ? buttonClasses("tertiary", "sm", "w-full") : buttonClasses("tertiary", "sm", "w-8 !px-0"))
        }
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
      >
        {triggerLabel ? (
          <>
            {triggerLabel}
            <ChevronDown size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          </>
        ) : (
          (triggerIcon ?? <MoreHorizontal size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />)
        )}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              style={{ position: "fixed", top: position.top, left: position.left, right: position.right }}
              className="card z-50 flex min-w-44 flex-col p-1"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="flex h-ctl items-center gap-2 rounded-ctl px-3 text-left text-sm text-ink hover:bg-sunken"
                  onClick={() => {
                    close(true);
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
