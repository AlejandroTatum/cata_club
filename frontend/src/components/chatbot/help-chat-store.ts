/**
 * The help assistant's open state, held in ONE module-level store.
 *
 * ## Why the state left the components
 *
 * CATA-BOT used to have three independent owners: `AppShell` (sidebar entry),
 * `HelpChatLauncher` (landing / auth / enrolment) and `/unauthorized`. Each
 * mounted its own `ChatWidget`, so "the assistant" was really three panels
 * that happened to look alike. The moment a persistent floating launcher was
 * added on top of that, the same screen could show two panels at once.
 *
 * So the panel is now mounted exactly once, by `HelpChatDock` in the root
 * layout, and every trigger in the product — the floating launcher, the
 * sidebar's "Ayuda y soporte", the landing's contact block, the auth screens'
 * small print, the enrolment wizard header, `/unauthorized`'s "Contactar al
 * club" and the trainer's "Avisar al club" — calls `openHelpChat()` and opens
 * THAT panel.
 *
 * ## Why a CustomEvent is still the ingress
 *
 * `openHelpChat` has always dispatched `cata:open-help-chat` on `window`, and
 * screens outside this module (the trainer's "Avisar al club") depend on that
 * contract. Keeping the event as the way IN means no call site had to change;
 * this store is simply the one listener that turns it into React state, plus
 * the read side (`useHelpChatState`) that lets a remote trigger report
 * `aria-expanded` truthfully.
 */

import { useSyncExternalStore } from "react";

/**
 * Event any screen can fire to open the help assistant, with an optional
 * `detail.draft` pre-filling the composer.
 *
 * The trainer's "Avisar al club" needs to reach the club about a specific
 * student, and there is NO backend endpoint for "notify the club" — the chat
 * is the only real channel. A custom event keeps that a one-line call from the
 * page instead of threading chat state through props or a context nobody else
 * needs.
 */
export const OPEN_HELP_CHAT_EVENT = "cata:open-help-chat";

export interface OpenHelpChatDetail {
  draft?: string;
}

export interface HelpChatState {
  /** Whether the single `ChatWidget` panel is on screen. */
  open: boolean;
  /** Text to seed the composer with on the open transition. */
  draft?: string;
}

const CLOSED: HelpChatState = { open: false, draft: undefined };

let state: HelpChatState = CLOSED;
const listeners = new Set<() => void>();

function setState(next: HelpChatState): void {
  state = next;
  for (const listener of listeners) listener();
}

function handleOpenEvent(event: Event): void {
  const detail = (event as CustomEvent<OpenHelpChatDetail>).detail;
  setState({ open: true, draft: detail?.draft });
}

/**
 * The window listener is attached while at least one component is reading the
 * store and removed when the last one unmounts — no module-level side effect,
 * so importing this file during SSR touches nothing.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener(OPEN_HELP_CHAT_EVENT, handleOpenEvent);
  }
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener(OPEN_HELP_CHAT_EVENT, handleOpenEvent);
    }
  };
}

function getSnapshot(): HelpChatState {
  return state;
}

/** The server renders the assistant closed; the client hydrates to the same. */
function getServerSnapshot(): HelpChatState {
  return CLOSED;
}

/** Ask the assistant to open, optionally with a message ready to send. */
export function openHelpChat(draft?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenHelpChatDetail>(OPEN_HELP_CHAT_EVENT, { detail: { draft } }),
  );
}

/** Close the assistant and forget any draft the opener seeded. */
export function closeHelpChat(): void {
  if (state.open || state.draft !== undefined) setState(CLOSED);
}

/** Full state — used by the one component that renders the panel. */
export function useHelpChatState(): HelpChatState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Whether the panel is on screen. Every trigger reads this so it can report
 * `aria-expanded` for a panel it no longer owns.
 */
export function useHelpChatOpen(): boolean {
  return useHelpChatState().open;
}

/** Test seam: drop the state back to closed between cases. */
export function resetHelpChatForTests(): void {
  state = CLOSED;
}
