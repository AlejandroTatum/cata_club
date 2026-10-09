/**
 * AccountMenu — the sidebar's account control.
 *
 * Ayuda, Perfil and Cerrar sesión used to be three permanent rows under the
 * nav, which is what pushed the admin rail past a 768px-tall viewport and gave
 * the nav its own scrollbar. They live here now, behind the user card — the
 * one control that is about the account — so the nav column only carries
 * destinations.
 *
 * The card is a real button (`aria-haspopup`, `aria-expanded`, `aria-controls`)
 * and says what it does with a chevron, which is the answer to issue #852: the
 * old card opened a popup nothing about it advertised. Escape, outside click
 * and the Tab cycle come from `useDismissablePopup`; Escape returns focus to
 * the card.
 */

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, CircleHelp, LogOut, User } from "lucide-react";
import AvatarPhoto from "@/components/AvatarPhoto";
import { ICON } from "@/lib/icon-size";
import { useDismissablePopup } from "@/lib/useDismissablePopup";

interface AccountMenuProps {
  name: string;
  roleLabel: string;
  initials: string;
  fotoUrl?: string | null;
  /** The rail is the 76px icon strip: only the avatar is drawn. */
  collapsed: boolean;
  onLogout: () => void;
  /** Called after any item is chosen (the mobile drawer closes itself). */
  onNavigate: () => void;
  /** Extra rows, drawn between the links and "Cerrar sesión". */
  children?: React.ReactNode;
}

const ITEM_CLASSES =
  "flex h-ctl w-full items-center gap-2.5 rounded-ctl px-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white";

export default function AccountMenu({
  name,
  roleLabel,
  initials,
  fotoUrl,
  collapsed,
  onLogout,
  onNavigate,
  children,
}: AccountMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback((): void => setOpen(false), []);

  useDismissablePopup({ open, onClose: close, panelRef, triggerRef });

  // Keyboard users land on the first item, so the menu is usable without a
  // second Tab hunt.
  useEffect((): void => {
    if (open) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  function choose(): void {
    close();
    onNavigate();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(): void => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Menú de cuenta de ${name}`}
        className={`flex min-h-[48px] w-full items-center gap-2.5 rounded-ctl bg-white/[0.06] px-2.5 py-2 text-left text-white transition-colors hover:bg-white/[0.1] ${
          collapsed ? "lg:justify-center lg:px-0" : ""
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cata-red/[0.28] text-2xs tracking-flat font-bold">
          <AvatarPhoto
            fotoUrl={fotoUrl}
            initials={initials}
            className="h-8 w-8 rounded-full object-cover"
          />
        </span>
        <span className={`min-w-0 flex-1 leading-tight ${collapsed ? "lg:hidden" : ""}`}>
          <span className="block truncate text-xs font-semibold">{name}</span>
          {/* White at 0.50 over the card's `coal` composite is 5.04:1. */}
          <span className="block truncate text-2xs tracking-flat text-white/50">{roleLabel}</span>
        </span>
        <ChevronUp
          size={ICON.sm}
          strokeWidth={2}
          aria-hidden="true"
          className={`shrink-0 text-white/60 transition-transform ${open ? "rotate-180" : ""} ${
            collapsed ? "lg:hidden" : ""
          }`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="dialog"
          aria-label="Menú de cuenta"
          className="absolute bottom-full left-0 z-50 mb-2 w-[212px] rounded-card border-2 border-white bg-coal-2 p-1.5 shadow-sticker-red"
        >
          <Link href="/profile" onClick={choose} className={ITEM_CLASSES}>
            <User size={ICON.base} strokeWidth={2} aria-hidden="true" />
            Perfil
          </Link>
          <Link href="/ayuda" onClick={choose} className={ITEM_CLASSES}>
            <CircleHelp size={ICON.base} strokeWidth={2} aria-hidden="true" />
            Ayuda
          </Link>
          {children}
          <div className="my-1 border-t border-white/[0.1]" />
          <button
            type="button"
            onClick={(): void => {
              onLogout();
              choose();
            }}
            className={ITEM_CLASSES}
          >
            <LogOut size={ICON.base} strokeWidth={2} aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
