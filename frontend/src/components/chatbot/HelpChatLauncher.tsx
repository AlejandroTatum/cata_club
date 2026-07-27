/**
 * HelpChatLauncher — a trigger that owns the assistant panel's open state.
 *
 * ## Why this exists
 *
 * `POST /chatbot/consultar` is public and unauthenticated, and the assistant
 * answers exactly the questions a prospective member has before they have an
 * account ("¿cuánto cuesta?", "¿qué horarios hay?", "¿cómo me inscribo?").
 * When `ChatWidget` moved from the root layout into `AppShell`, that whole
 * audience lost it: the panel only existed behind a sidebar that only exists
 * after login.
 *
 * Mounting it globally again is not the fix. The reason it left the layout was
 * its floating action button — `fixed bottom-5 right-5 z-40`, sitting over the
 * landing's WhatsApp block and over the trainer's attendance controls. So the
 * FAB does not come back. Instead each public surface gets a trigger that
 * belongs to its own composition:
 *
 *   · the landing's contact block, beside the WhatsApp button — the place a
 *     visitor already goes to ask something;
 *   · `AuthShell`'s small print, under the card, for /login, /forgot-password
 *     and /reset-password;
 *   · the enrolment wizard's header, where the questions are about the form
 *     being filled in.
 *
 * Since the floating launcher came back as `HelpChatDock`, this component no
 * longer mounts a panel of its own — it is a TRIGGER. It calls
 * `openHelpChat()` and the dock's single `ChatWidget` opens, which is what
 * keeps "the assistant" one thing: the same conversation, the same role-scoped
 * quick replies, and never two panels on one screen. The inline triggers stay
 * because they are where the question is actually asked (beside the WhatsApp
 * button, under the login form, in the wizard header) — the float is the
 * answer to "I could not find it", not a replacement for them.
 */

"use client";

import { MessageCircle } from "lucide-react";
import { openHelpChat, useHelpChatOpen } from "./help-chat-store";

export interface HelpChatLauncherProps {
  /**
   * `landing` borrows the landing's own quiet button so it sits under
   * "Escríbenos por WhatsApp" without competing with it. `quiet` is the
   * hairline text trigger the auth and enrolment surfaces use, where a
   * full button would outrank the form.
   */
  variant: "landing" | "quiet";
  /** Trigger label. Defaults to the wording the landing and auth screens share. */
  label?: string;
  className?: string;
}

const DEFAULT_LABEL = "Pregúntale al asistente";

const TRIGGER_CLASSES: Record<HelpChatLauncherProps["variant"], string> = {
  landing: "landing-button landing-button-quiet landing-button-block",
  // `min-h-[24px]`: the 11.5px label plus `py-0.5` measured 21px tall, under
  // the 24x24 WCAG 2.2 AA target size (SC 2.5.8). The height is hit area only —
  // `items-center` keeps the label and its underline exactly where they were.
  quiet:
    "inline-flex min-h-[24px] items-center gap-1.5 rounded-ctl px-1 py-0.5 text-[11.5px] font-semibold " +
    "text-ink-2 underline decoration-line-2 underline-offset-[3px] transition-colors " +
    "hover:text-cata-red hover:decoration-cata-red",
};

export default function HelpChatLauncher({
  variant,
  label = DEFAULT_LABEL,
  className,
}: HelpChatLauncherProps): React.ReactElement {
  // Read, not owned: the panel belongs to `HelpChatDock`, but a trigger that
  // declares `aria-expanded` still has to tell the truth about it.
  const open = useHelpChatOpen();

  return (
    <button
      type="button"
      onClick={(): void => openHelpChat()}
      aria-expanded={open}
      className={className ? `${TRIGGER_CLASSES[variant]} ${className}` : TRIGGER_CLASSES[variant]}
    >
      {/* Nudged up from 17/13 so the assistant reads as an offer rather than a
          footnote. Deliberately NOT scaled to match the floating launcher: this
          glyph sits inline with an 11.5px label, and an icon that outgrows its
          own text stops looking like part of the sentence. */}
      <MessageCircle size={variant === "landing" ? 20 : 16} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}
