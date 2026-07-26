/**
 * NotificationBell — presentational dropdown for in-app notifications.
 *
 * Owns only its own open/closed UI state; data (list, load error, mark-read)
 * comes from `useNotificaciones()`, called once in Header and passed down —
 * see that hook's doc comment for why this component doesn't fetch/poll on
 * its own (Header renders it twice: desktop nav + mobile drawer).
 */

"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { Notificacion, TipoNotificacion } from "@/types/domain";
import { formatDateTime } from "@/lib/format-utils";
import { useDismissablePopup } from "@/lib/useDismissablePopup";

const TIPO_LABELS: Record<TipoNotificacion, string> = {
  MIEMBRESIA_VENCIMIENTO_PROXIMO: "Membresía próxima a vencer",
  PAGO_APROBADO: "Pago aprobado",
  PAGO_RECHAZADO: "Pago rechazado",
  NUEVA_INSCRIPCION: "Nueva inscripción",
};

export interface NotificationBellProps {
  notificaciones: Notificacion[];
  loadError: boolean;
  onMarkRead: (id: number) => void;
  /**
   * Trigger button theme. `"dark"` (default) matches `Header.tsx`'s dark
   * `bg-cata-dark/95` topbar — its original and only host until `AppShell`
   * hoisted this component onto its light `bg-cata-surface` topbar, where
   * the dark-only colors made the icon unreadable. `"light"` matches
   * AppShell's other topbar buttons (`text-cata-text/65`).
   */
  variant?: "dark" | "light";
}

const TRIGGER_VARIANT_CLASSES: Record<"dark" | "light", string> = {
  dark: "relative rounded-xl p-2 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white",
  light: "relative rounded-xl p-2 text-cata-text/65 transition-colors hover:bg-cata-bg hover:text-cata-text",
};

export default function NotificationBell({
  notificaciones,
  loadError,
  onMarkRead,
  variant = "dark",
}: NotificationBellProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const unreadCount = notificaciones.filter((n) => !n.leida).length;

  const close = useCallback((): void => setOpen(false), []);
  useDismissablePopup({ open, onClose: close, panelRef, triggerRef });

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={TRIGGER_VARIANT_CLASSES[variant]}
        // The panel is a plain labelled container, not a menu — `aria-haspopup="true"`
        // is an alias for "menu" and promised keyboard behavior this popup does not have.
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notificaciones — ${unreadCount} sin leer` : "Notificaciones"}
      >
        <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cata-red px-1 text-[10px] font-bold text-white"
            aria-hidden="true"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notificaciones"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-cata-border bg-cata-surface p-2 shadow-elevated"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-cata-text/45">Notificaciones</p>
            {unreadCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-cata-red">
                <CheckCheck size={11} strokeWidth={1.5} aria-hidden="true" />
                {unreadCount} sin leer
              </span>
            )}
          </div>

          {loadError && notificaciones.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-cata-text/50">
              No se pudieron cargar las notificaciones.
            </p>
          )}

          {!loadError && notificaciones.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-cata-text/50">No hay notificaciones.</p>
          )}

          {notificaciones.length > 0 && (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {notificaciones.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => !n.leida && onMarkRead(n.id)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-cata-bg ${
                      n.leida ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {!n.leida && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cata-red" aria-hidden="true" />
                      )}
                      <p className="text-xs font-medium text-cata-text">{TIPO_LABELS[n.tipo]}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-cata-text/65">{n.mensaje}</p>
                    <p className="mt-1 text-[10px] text-cata-text/40">{formatDateTime(n.fechaCreacion)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
