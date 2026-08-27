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
 * close control, and this keeps the two from ever sharing a corner — and hands
 * focus back to whatever opened the panel when it closes.
 *
 * ## Why the float steps down on the app shell from `lg` up (#59)
 *
 * The yielding above answers "what furniture is under the corner?". It does
 * not answer "what CONTENT is under the corner?", and the note above assumed
 * that question had no answer worth asking — page content under a float being
 * unavoidable. Measured on /members with 40 rows, it is answerable and the
 * answer is bad:
 *
 * | Viewport  | Launcher rect        | Covered control, by scroll offset          |
 * |-----------|----------------------|--------------------------------------------|
 * | 1440x900  | (1344,804) 76x76     | top "Editar" (1334..1397, centre x 1365)   |
 * |           |                      | foot "Página siguiente" (centre 1345,839)  |
 * | 1280x720  | (1184,624) 76x76     | top "Editar" (1176..1237, centre x 1207)   |
 * |           |                      | foot "Página siguiente" (centre 1185,659)  |
 *
 * Two things that matter. First, it is not a page-foot defect: the page
 * scrolls under a viewport-fixed element, so a different row is dead at every
 * scroll offset and reserving space at the foot of the table fixes none of
 * them. Second, the trapped control at the foot is the PAGER, not a row —
 * "Página siguiente" ends on the same right edge the action lane does, and at
 * maximum scroll there is nowhere left to scroll it out from under the disc.
 *
 * The collision is structural: a float anchored bottom-right against the
 * right-aligned action lane that `ui/Table` and `ui/Pagination` share. It only
 * exists from `lg` up, where the disc grows to 76x76 at a 20px inset — below
 * `lg` the disc is 44x44 at an 8px inset and clears both lanes, and the
 * account list is cards rather than a table anyway.
 *
 * `lg` is also exactly where the app shell's sidebar stops being a drawer and
 * is permanently on screen, carrying its own "Ayuda y soporte" row at
 * x 10..226 — measured at both 1440 and 1280, at every scroll offset. So on
 * those routes the float is not the assistant's only door; it is a second door
 * standing in the action lane. It steps down and the rail keeps the assistant.
 *
 * It steps down on `app` routes ONLY. On the landing, the auth screens, the
 * enrolment funnel and `/unauthorized` there is no rail, which is the whole
 * reason the float came back — so there it floats at every width.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { resolveShellKind } from "@/lib/shell-routes";
import ChatWidget, { BOT_NAME } from "./ChatWidget";
import {
  closeHelpChat,
  openHelpChat,
  useHelpChatState,
  OPEN_HELP_CHAT_EVENT,
} from "./help-chat-store";
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

interface RestingCorner {
  top: number;
  bottom: number;
  centerX: number;
}

/**
 * Where the launcher would sit if it had never yielded, in viewport
 * coordinates — the corner it must keep probing even after it has left it.
 *
 * Asked of the CSS inset (`bottom-4`, `lg:bottom-5`) and not of
 * `getBoundingClientRect()`, which reports where the launcher is DRAWN. Those
 * two answers differ for 200ms at a time, because the lift is a `transform`
 * under `transition-[transform,opacity] duration-200`, and that gap was #89:
 * the rest rect used to be reconstructed as "drawn rect + the lift already
 * applied", which is only true once the transition has finished. At its first
 * frame the launcher is still drawn exactly at rest, so adding 58px pushed the
 * reconstructed rect 58px BELOW the floor of the viewport, every probe point
 * fell out of range, and the launcher concluded its corner was free and
 * dropped back onto the tab bar it had just cleared.
 *
 * The inset cannot drift like that: it is where the launcher rests, whatever
 * it is currently doing, and the answer is the same on every re-measurement.
 * Only the height and the horizontal centre come from the drawn rect, and a
 * `translateY` changes neither.
 */
function measureRestingCorner(dock: HTMLElement): RestingCorner | null {
  const rect = dock.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const inset = Number.parseFloat(window.getComputedStyle(dock).bottom);
  // `bottom: auto` should not happen — the launcher is `fixed bottom-4` — but
  // a stylesheet that has not arrived would report it, and the drawn rect is
  // then the best answer available and the right one while nothing has lifted.
  const bottom = Number.isFinite(inset) ? window.innerHeight - inset : rect.bottom;
  return { top: bottom - rect.height, bottom, centerX: rect.left + rect.width / 2 };
}

/** How far the launcher must climb to clear whatever is under its resting spot. */
function measureNeededLift(dock: HTMLElement): number {
  if (typeof document.elementsFromPoint !== "function") return 0;
  const corner = measureRestingCorner(dock);
  if (corner === null) return 0;

  const viewportHeight = window.innerHeight;
  const { top: restTop, bottom: restBottom, centerX } = corner;

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
 * page swapping its own content — the shell mounts the admin's phone tab bar
 * once the session names a role, and the attendance wizard grows a commit bar
 * when the trainer advances a step. Hence a scroll/resize pair plus a
 * `MutationObserver`, all funnelled through one timer so a burst of DOM edits
 * costs a single measurement.
 *
 * ## Why a timer and not `requestAnimationFrame` (#89)
 *
 * It was a frame, and a page that has not painted yet produces none. Measured
 * in Chromium on /members at 390×844: the first callback was requested at 77ms
 * and ran at **2055ms**. The tab bar arrived at 115ms, inside that window, and
 * the coalescing guard below made it worse than a late measurement — reading
 * "a frame is pending" as "a measurement is pending", it discarded all three
 * `MutationObserver` firings of that window instead of deferring them. So the
 * launcher sat on the tab bar until an unrelated frame finally shipped.
 *
 * A `ResizeObserver` on the tab bar, the first fix the issue proposed, would
 * not have helped: its callbacks are delivered in the same "update the
 * rendering" step, and instrumented on the same page it stayed silent for the
 * whole stall alongside `requestAnimationFrame`. Timers are the one scheduler
 * that kept running through it — a 40ms interval ticked all the way.
 *
 * Nothing is lost by the swap. `requestAnimationFrame` earns its keep when the
 * work must land in the frame it measured, and this work cannot: the
 * measurement forces its own layout (`getBoundingClientRect`,
 * `elementsFromPoint`) wherever it runs, and the `setClearance` it ends with
 * paints a frame later either way. The throttling is unchanged too — scroll
 * events are dispatched once per frame, so one coalesced timer per event is
 * one measurement per frame, exactly as before.
 */
function useDockClearance(dockRef: React.RefObject<HTMLElement | null>): DockClearance {
  const [clearance, setClearance] = useState<DockClearance>(FREE_CORNER);

  useEffect((): (() => void) => {
    let pending = 0;

    function measure(): void {
      pending = 0;
      const dock = dockRef.current;
      if (!dock) return;
      const next = resolveClearance(measureNeededLift(dock));
      setClearance((prev) =>
        prev.lift === next.lift && prev.withdrawn === next.withdrawn ? prev : next,
      );
    }

    function schedule(): void {
      if (pending) return;
      pending = window.setTimeout(measure, 0);
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
      if (pending) window.clearTimeout(pending);
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
 *
 * @touch-target The phone disc is the floor itself; see `docs/ux/objetivo-tactil.md`.
 */
const LAUNCHER_CLASSES =
  "fixed bottom-4 right-2 z-40 flex h-11 w-11 items-center justify-center rounded-full " +
  "bg-white text-ink border border-line-2 shadow-float " +
  "transition-[transform,opacity] duration-200 ease-out hover:bg-paper " +
  "lg:bottom-5 lg:right-5 lg:h-[76px] lg:w-[76px]";

/**
 * The step-down, as a media query and not as a measurement.
 *
 * The clearance withdrawal above keeps the button rendered on purpose, so it
 * can go on measuring its own corner and come back when the corner frees up.
 * This one is not conditional on anything that moves: above `lg` on an `app`
 * route the rail is on screen and the float is redundant, full stop. So it is
 * the same `lg` media query that grows the disc rather than a `matchMedia`
 * probe — nothing to hydrate, nothing to flash — and `display: none` rather
 * than opacity, which takes the button out of the accessibility tree and the
 * tab order without `aria-hidden` or `tabIndex` having to say so.
 */
const RAIL_CARRIES_THE_ASSISTANT = "lg:hidden";

export default function HelpChatDock(): React.ReactElement {
  const { session } = useAuth();
  const { open, draft } = useHelpChatState();
  const pathname = usePathname();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const clearance = useDockClearance(launcherRef);
  const wasOpenRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  // `usePathname` is typed non-null but returns null on the error boundaries
  // Next renders outside the router, and the root layout mounts this dock on
  // every one of them. Treated as "no rail", which is the safe side: the float
  // stays rather than vanishing from a screen that has nothing else.
  const railCarriesTheAssistant = resolveShellKind(pathname ?? "/") === "app";

  const handleClose = useCallback((): void => closeHelpChat(), []);

  // Escape closes the panel from anywhere inside it, and — below `sm`, where
  // the panel is a sheet that traps Tab — it is the only way out that does not
  // need the close button. Document-level rather than dialog-scoped because
  // the corner card from `sm` up is `aria-modal="false"` and leaves focus free
  // to wander onto the page behind it.
  useEffect((): undefined | (() => void) => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") closeHelpChat();
    }
    window.addEventListener("keydown", handleKeyDown);
    return (): void => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  /*
   * Remember which trigger opened the panel.
   *
   * On the open EVENT and not in an effect: the event is dispatched
   * synchronously from the trigger's own click handler, so `activeElement` is
   * still the trigger. By the time effects run, the panel has mounted and
   * focused its own composer, and the dock would remember the textarea.
   */
  useEffect((): (() => void) => {
    function rememberOpener(): void {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    window.addEventListener(OPEN_HELP_CHAT_EVENT, rememberOpener);
    return (): void => window.removeEventListener(OPEN_HELP_CHAT_EVENT, rememberOpener);
  }, []);

  // Closing hands focus back to whatever opened the panel instead of dropping
  // it on `<body>`, which would send the next Tab to the top of the document.
  //
  // It used to hand focus to this launcher unconditionally, which was the same
  // thing as long as the launcher was the only trigger on screen. It is not:
  // the rail's "Ayuda y soporte" row opens the same panel, and above `lg` on an
  // `app` route the launcher is now the trigger that is NOT there. Falling back
  // to the launcher covers the opener that has since left the document.
  useEffect((): void => {
    if (wasOpenRef.current && !open) {
      const opener = openerRef.current;
      const target = opener?.isConnected ? opener : launcherRef.current;
      target?.focus({ preventScroll: true });
      openerRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  const hidden = open || clearance.withdrawn;
  const stepDown = railCarriesTheAssistant ? RAIL_CARRIES_THE_ASSISTANT : "";

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
        } ${stepDown}`}
        style={clearance.lift ? { transform: `translateY(-${clearance.lift}px)` } : undefined}
      >
        {/*
          `unoptimized`: this is `cata-club-crest-256.png`, a pre-sized
          256×256 (23.6KB) derivative of `cata-club-logo-avatar.png` — see
          issue #681. A real CI trace showed Next's `/_next/image` optimizer
          can get one specific request/cache key stuck forever (`status: -1`,
          confirmed across three separate fresh page loads on the same
          server), and no client-side retry outran it. Serving this asset
          unoptimized means no consumer ever asks the optimizer for it, so
          that cache key never exists to get stuck. 256 already covers this
          64px box (`lg:h-16 w-16`) at 4x, so there is no size left to ask
          for — `width`/`height={128}` here are just the element's box hint
          now, not a srcset lever; `object-cover` on the `<img>` itself still
          scales it down to fill the 40px box at the smaller breakpoint,
          exactly like the hero paddle crest below does. The cropped source
          crop, not the raw JPEG — see `ChatWidget`'s own comment for why the
          full logo's wordmark band can't just be `object-cover`'d away. Its
          transparent margin relies on this button's own `bg-white`
          (`LAUNCHER_CLASSES` below) showing through instead of the JPEG's
          light-grey square.
        */}
        <span className="relative block h-10 w-10 overflow-hidden rounded-full lg:h-16 lg:w-16">
          <Image
            src="/brand/cata-club-crest-256.png"
            alt=""
            width={128}
            height={128}
            unoptimized
            className="h-full w-full object-cover"
          />
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
