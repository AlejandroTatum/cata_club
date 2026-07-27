/**
 * HelpChatDock — the persistent floating launcher, and the ONE place the
 * `ChatWidget` panel is mounted.
 *
 * ## Why the float is back, and why it is not the old FAB
 *
 * The product used to carry `fixed bottom-5 right-5 z-40 h-14 w-14`, mounted
 * unconditionally in the root layout. It was removed for two measured reasons,
 * both still true: at 390px it covered the trainer's sticky attendance commit
 * bar — the one-handed courtside task the whole role exists for — and it
 * covered the landing's WhatsApp block, which is the club's actual enrolment
 * channel. After the removal the assistant was reachable only from a sidebar
 * row, a landing card, a footnote under the login form and a wizard header,
 * and on /login that reads as hidden. It was.
 *
 * So the launcher floats again, and the occlusion does not come back, because
 * it YIELDS instead of sitting still:
 *
 *   · Its rest position is the bottom-right corner — 16px in on a phone,
 *     20px on a laptop.
 *   · Before it paints, and on every scroll, resize and DOM change, it looks
 *     at what is actually underneath it. Anything `fixed`/`sticky` that is
 *     flush with the bottom edge of the viewport OWNS that corner, and the
 *     launcher climbs above it by 12px.
 *   · If climbing clear would cost more than `MAX_LIFT_PX`, the surface owns
 *     the whole bottom of the screen and the launcher withdraws entirely
 *     rather than hover in the middle of someone's content.
 *
 * Measured at 390×844 that resolves to: +58px over the admin phone tab bar
 * (62px tall, so 12px of gap above it), and a withdrawal on the trainer's
 * attendance roster, whose commit bar is 165px tall and 341px wide — there is
 * no corner left to stand in. On that one screen the assistant stays where it
 * already was, in the drawer's "Ayuda y soporte" row. At 1440×900 nothing is
 * bottom-anchored under the corner, so the launcher simply rests there on
 * every surface.
 *
 * ## One panel, many triggers
 *
 * State lives in `help-chat-store`, so the sidebar row, the landing's contact
 * block, the auth small print, the enrolment header, `/unauthorized` and this
 * launcher all open the SAME panel with the SAME role-scoped quick replies.
 * The launcher hides itself while the panel is open — the panel has its own
 * close control, and this keeps the two from ever sharing a corner — and takes
 * focus back when the panel closes.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import ChatWidget, { BOT_NAME } from "./ChatWidget";
import { closeHelpChat, openHelpChat, useHelpChatState } from "./help-chat-store";
import { LAUNCHER_FOCUS_RING } from "./chat-focus-ring";

/** Breathing room left between the launcher and the furniture that pushed it up. */
const OBSTACLE_GAP_PX = 12;

/**
 * How far the launcher will climb before it withdraws instead.
 *
 * The phone tab bar is 62px and the launcher rests 16px off the bottom, so
 * clearing it costs 58px. Anything that costs appreciably more is not a strip
 * along the bottom edge — it is a panel that owns the bottom of the screen
 * (the trainer's 165px commit bar costs 161px), and a launcher parked above it
 * would be floating in the middle of the content the user is working through.
 * 96px is the line: one tab bar's worth of yielding, plus slack for a taller
 * bar or a safe-area inset, and nothing beyond that.
 */
const MAX_LIFT_PX = 96;

export interface DockClearance {
  /** Pixels to raise the launcher by, 0 when the corner is free. */
  lift: number;
  /** Whether the launcher steps off screen because the corner is not shareable. */
  withdrawn: boolean;
}

const FREE_CORNER: DockClearance = { lift: 0, withdrawn: false };

/**
 * Turn "the corner is blocked from here up" into what the launcher does about
 * it. Exported for its own unit tests — the DOM probing around it cannot run
 * in jsdom, but this decision is the part with a rule in it.
 */
export function resolveClearance(neededLift: number): DockClearance {
  if (neededLift <= 0) return FREE_CORNER;
  if (neededLift > MAX_LIFT_PX) return { lift: 0, withdrawn: true };
  return { lift: neededLift, withdrawn: false };
}

/**
 * The top edge of the nearest ancestor (self included) that is furniture
 * rather than page content, or `null` when this element just scrolls past.
 *
 * "Furniture" is `fixed` or `sticky`, because those are the things that stay
 * in the corner while the user scrolls — page content underneath a floating
 * launcher is unavoidable and always has been; furniture underneath it is the
 * bug this component exists to avoid.
 *
 * `top > 0` excludes full-height overlays: a modal backdrop or the sidebar
 * rail is not bottom furniture, and treating it as such would withdraw the
 * launcher for the whole page.
 *
 * Note there is deliberately no "is it flush with the viewport bottom?" test.
 * A `sticky bottom-0` bar stops being flush the moment the page reaches its
 * last scroll position and the bar lands — and the trainer's commit bar is
 * still exactly as much in the way after it lands as it was while stuck.
 */
function findFurnitureTop(start: Element, ownerDocumentBody: HTMLElement): number | null {
  for (let el: Element | null = start; el && el !== ownerDocumentBody; el = el.parentElement) {
    const position = window.getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.top > 0) return rect.top;
  }
  return null;
}

/**
 * How far the launcher must climb to clear whatever is under its RESTING spot.
 *
 * The rest rect is reconstructed from the live rect plus the lift already
 * applied, so a launcher that has already moved keeps probing the corner it
 * came from — otherwise it would find the corner empty (because it left) and
 * drop straight back onto the obstacle, forever.
 */
function measureNeededLift(dock: HTMLElement, appliedLift: number): number {
  if (typeof document.elementsFromPoint !== "function") return 0;
  const rect = dock.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 0;

  const viewportHeight = window.innerHeight;
  const restBottom = rect.bottom + appliedLift;
  const restTop = rect.top + appliedLift;
  const centerX = rect.left + rect.width / 2;

  // Three points down the rest rect, top edge included: when a `sticky` bar
  // lands (the page hits its last scroll position) it climbs out of the
  // corner a few pixels at a time, and a probe that only sampled the middle
  // and the bottom let the launcher drop back onto the last 7px of it.
  let needed = 0;
  for (const y of [restTop + 2, (restTop + restBottom) / 2, restBottom - 2]) {
    if (y < 0 || y > viewportHeight - 1) continue;
    for (const element of document.elementsFromPoint(centerX, y)) {
      if (element === dock || dock.contains(element)) continue;
      const top = findFurnitureTop(element, document.body);
      if (top !== null) needed = Math.max(needed, restBottom - top + OBSTACLE_GAP_PX);
    }
  }
  return needed;
}

/**
 * Keep `clearance` in step with what is actually under the corner.
 *
 * Three things move the answer and none of them is a React render: scrolling
 * (a `sticky` bar engages), resizing (the tab bar appears below `lg`), and the
 * page swapping its own content (the attendance wizard grows a commit bar when
 * the trainer advances a step). Hence a scroll/resize pair plus a
 * `MutationObserver`, all funnelled through one `requestAnimationFrame` so a
 * burst of DOM edits costs a single measurement.
 */
function useDockClearance(dockRef: React.RefObject<HTMLElement | null>): DockClearance {
  const [clearance, setClearance] = useState<DockClearance>(FREE_CORNER);
  const appliedLiftRef = useRef(0);

  useEffect((): (() => void) => {
    let frame = 0;

    function measure(): void {
      frame = 0;
      const dock = dockRef.current;
      if (!dock) return;
      const next = resolveClearance(measureNeededLift(dock, appliedLiftRef.current));
      appliedLiftRef.current = next.lift;
      setClearance((prev) =>
        prev.lift === next.lift && prev.withdrawn === next.withdrawn ? prev : next,
      );
    }

    function schedule(): void {
      if (frame) return;
      frame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(measure)
          : window.setTimeout(measure, 0);
    }

    schedule();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);

    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(schedule)
        : null;
    observer?.observe(document.body, { childList: true, subtree: true });

    return (): void => {
      if (frame) window.cancelAnimationFrame?.(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [dockRef]);

  return clearance;
}

/**
 * `.launcher` — a coal disc wearing CATA-BOT's own face. Coal and not red:
 * red is this product's primary-CTA and destructive colour, and a red disc
 * floating over every screen would outrank the actual CTA on all of them.
 * 44px on a phone (the touch-target floor) and 76px from `lg` up.
 *
 * The phone disc is pinned at 44px and CANNOT grow: the corner budget below is
 * what lets it sit beside the landing's WhatsApp CTA at all, and the 56px FAB
 * this replaced is exactly what made that impossible. So when the disc read as
 * too small to notice, the face inside it grew to fill it (40px of a 44px disc)
 * rather than the disc growing outward. From `lg` up the corner is empty, so
 * there the whole disc grows instead — 52px to 76px.
 *
 * `right-2` on phones, not the `right-3` that would match the panel: the
 * landing's contact card leaves its WhatsApp CTA ending a constant 57px from
 * the right edge of the viewport at every phone width, and a 44px disc inset
 * 12px starts at 56px — a 1px gap, which reads as a collision even though it
 * measures as clearance. At 8px the same two edges sit 5px apart. From `lg`
 * up the corner is empty and the launcher takes the system's usual 20px.
 */
const LAUNCHER_CLASSES =
  "fixed bottom-4 right-2 z-40 flex h-11 w-11 items-center justify-center rounded-full " +
  "bg-coal text-white shadow-[0_10px_28px_rgba(19,19,22,0.30)] " +
  "transition-[transform,opacity] duration-200 ease-out hover:bg-coal-3 " +
  "lg:bottom-5 lg:right-5 lg:h-[76px] lg:w-[76px]";

export default function HelpChatDock(): React.ReactElement {
  const { session } = useAuth();
  const { open, draft } = useHelpChatState();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const clearance = useDockClearance(launcherRef);
  const wasOpenRef = useRef(false);

  const handleClose = useCallback((): void => closeHelpChat(), []);

  // Escape closes the panel from anywhere inside it. The panel is
  // `aria-modal="false"` on purpose — it does not trap focus — so this is a
  // document-level listener rather than a dialog-scoped one.
  useEffect((): undefined | (() => void) => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") closeHelpChat();
    }
    window.addEventListener("keydown", handleKeyDown);
    return (): void => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Closing hands focus back to the launcher instead of dropping it on
  // `<body>`, which would send the next Tab to the top of the document.
  useEffect((): void => {
    if (wasOpenRef.current && !open) {
      launcherRef.current?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open;
  }, [open]);

  const hidden = open || clearance.withdrawn;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={(): void => openHelpChat()}
        aria-expanded={open}
        aria-label={`Abrir ${BOT_NAME}, el asistente del club`}
        title={`Abrir ${BOT_NAME}`}
        /* Kept in the DOM while hidden so it can go on measuring its own
           corner; `tabIndex={-1}` and `pointer-events-none` keep an invisible
           control out of the tab order and out of the way of clicks. */
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
        className={`${LAUNCHER_CLASSES} ${LAUNCHER_FOCUS_RING} ${
          hidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        style={clearance.lift ? { transform: `translateY(-${clearance.lift}px)` } : undefined}
      >
        {/*
          The 512px master at `sizes="128px"`, for the same reason the panel
          header asks for 96: `sizes` is CSS pixels, so asking for the laid-out
          size makes Next serve exactly that many real pixels and every HiDPI
          screen upscales them.
        */}
        <span className="relative block h-10 w-10 overflow-hidden rounded-full lg:h-16 lg:w-16">
          <Image src="/brand/cata-bot.png" alt="" fill sizes="128px" className="object-contain" />
        </span>
      </button>

      <ChatWidget
        open={open}
        role={session?.user.role ?? null}
        initialDraft={draft}
        onClose={handleClose}
      />
    </>
  );
}
