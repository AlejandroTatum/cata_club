/**
 * WhatsNewDialog — the release note shown once after login.
 *
 * Mounted once in `AppShell`, so it can only appear on the first authenticated
 * screen — never on the landing or the public auth pages. It also waits for
 * the legal re-accept gate: that gate publishes what it knows through
 * `legal-gate-status`, and until it has answered "nothing pending" this
 * renders nothing. A release note must never sit on top of, or race, a
 * blocking terms dialog.
 *
 * What it says lives in `lib/whats-new/content`; whether it shows lives in
 * `useWhatsNew`. Closing it any way (button, Escape, backdrop, the help link)
 * marks the current version as seen.
 *
 * The chrome is the product's dialog chrome (the same panel, motion tokens and
 * focus trap as `LegalReacceptGate`), so it inherits sticker styling, dark
 * mode and the reduced-motion switch.
 */

"use client";

import { useRef, type ReactElement } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { useBodyScrollLock } from "@/components/ui/useBodyScrollLock";
import { useAuth } from "@/contexts/AuthContext";
import { userRolesFromBackendRoles } from "@/lib/auth-utils";
import { useModalFocusTrap } from "@/lib/focus-trap";
import {
  WHATS_NEW_ACTIONS,
  WHATS_NEW_HEADER,
  WHATS_NEW_ITEMS,
  splitLead,
  whatsNewAudienceFor,
} from "@/lib/whats-new/content";
import { useWhatsNew } from "@/lib/whats-new/use-whats-new";
import { useLegalGateStatus } from "@/components/legal/legal-gate-status";

export default function WhatsNewDialog(): ReactElement | null {
  const { isAuthenticated, isLoading, session } = useAuth();
  const legalStatus = useLegalGateStatus();
  const { open, dismiss } = useWhatsNew(isAuthenticated && !isLoading && legalStatus === "clear");
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useModalFocusTrap({ open, onClose: dismiss, panelRef, initialFocusRef: dismissRef });
  useBodyScrollLock(open);

  if (!open) return null;

  const roles = userRolesFromBackendRoles(session?.roles ?? []);
  if (roles.length === 0 && session) roles.push(session.user.role);
  const audience = whatsNewAudienceFor(roles);
  const items = audience === null ? [] : WHATS_NEW_ITEMS[audience];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pt-4 sm:items-center sm:pb-4">
      <div
        aria-hidden="true"
        data-testid="whats-new-backdrop"
        onClick={dismiss}
        className="absolute inset-0 animate-overlay-in bg-cata-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        aria-describedby="whats-new-intro"
        className="card relative flex max-h-[85dvh] w-full max-w-measure animate-sheet-in flex-col overflow-hidden p-0 shadow-elevated sm:animate-dialog-in"
      >
        <header className="flex-none border-b border-line px-page pb-section pt-page">
          <span aria-hidden="true" className="mb-4 block h-0.5 w-8 bg-cata-red" />
          <h2
            id="whats-new-title"
            className="text-balance font-display text-lg uppercase leading-crisp tracking-flat text-cata-text sm:text-xl"
          >
            {WHATS_NEW_HEADER.title}
          </h2>
          <p id="whats-new-intro" className="mt-3 text-sm text-cata-text">
            {WHATS_NEW_HEADER.intro}
          </p>
        </header>

        {items.length > 0 && (
          <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-page py-section">
            {items.map((item) => {
              const { lead, rest } = splitLead(item);
              return (
                <li key={item} className="flex min-w-0 gap-3 text-sm leading-snug text-cata-text">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-none rounded-full bg-ball" />
                  <span className="min-w-0 break-words">
                    {lead !== null && <strong className="font-bold">{lead}</strong>}
                    {rest}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-page py-section">
          <Link
            href={WHATS_NEW_ACTIONS.helpHref}
            onClick={dismiss}
            className="text-sm font-semibold text-cata-red-dark underline underline-offset-4 hover:text-cata-red"
          >
            {WHATS_NEW_ACTIONS.help}
          </Link>
          <Button ref={dismissRef} variant="primary" onClick={dismiss}>
            {WHATS_NEW_ACTIONS.dismiss}
          </Button>
        </footer>
      </div>
    </div>
  );
}
