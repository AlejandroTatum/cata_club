/**
 * Component tests for NotificationBell — now presentational (data comes
 * from props, fed by the useNotificaciones hook one level up in Header; see
 * useNotificaciones.test.ts for the data/poll/mark-read behavior).
 *
 * @vitest-environment jsdom
 */

import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NotificationBell from "@/components/NotificationBell";
import type { Notificacion } from "@/types/domain";

function makeNotificacion(overrides: Partial<Notificacion> = {}): Notificacion {
  return {
    id: 1,
    tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
    mensaje: "Tu membresía vence pronto.",
    leida: false,
    fechaCreacion: "2026-07-19T10:00:00Z",
    entidadRelacionadaId: 5,
    ...overrides,
  };
}

function renderBell(overrides: Partial<ComponentProps<typeof NotificationBell>> = {}) {
  return render(
    <NotificationBell
      notificaciones={[]}
      loadError={false}
      onMarkRead={vi.fn()}
      onMarkAllRead={vi.fn()}
      marcandoTodas={false}
      errorMarcarTodas={false}
      {...overrides}
    />,
  );
}

describe("NotificationBell", () => {
  it("shows no unread badge when there are no notifications", () => {
    renderBell();

    expect(screen.queryByText(/sin leer/i)).not.toBeInTheDocument();
  });

  // --- "Marcar todas como leídas" (issue #859) ---

  it("does not render the mark-all button when there are no unread notifications", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: true })] });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.queryByRole("button", { name: /marcar todas/i })).not.toBeInTheDocument();
  });

  it("renders the mark-all button when there are unread notifications", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: false })] });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByRole("button", { name: /marcar todas/i })).toBeInTheDocument();
  });

  it("calls onMarkAllRead when the mark-all button is clicked", () => {
    const onMarkAllRead = vi.fn();
    renderBell({ notificaciones: [makeNotificacion({ leida: false })], onMarkAllRead });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));
    fireEvent.click(screen.getByRole("button", { name: /marcar todas/i }));

    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("disables the mark-all button and marks it busy while in flight", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: false })], marcandoTodas: true });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));
    const boton = screen.getByRole("button", { name: /marcar todas/i });

    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("aria-busy", "true");
  });

  it("is reachable by keyboard, alongside the notification list items", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: false })] });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByRole("button", { name: /marcar todas/i })).toHaveAttribute("type", "button");
  });

  it("announces an error via a polite live region when marking all read fails", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: false })], errorMarcarTodas: true });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/no se pudieron marcar/i);
  });

  it("does not announce an error when marking all read has not failed", () => {
    renderBell({ notificaciones: [makeNotificacion({ leida: false })] });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.queryByText(/no se pudieron marcar/i)).not.toBeInTheDocument();
  });

  it("shows the unread count badge", () => {
    renderBell({
      notificaciones: [makeNotificacion({ id: 1, leida: false }), makeNotificacion({ id: 2, leida: true })],
    });

    expect(screen.getByLabelText(/1 sin leer/i)).toBeInTheDocument();
  });

  it("opens the dropdown and lists notifications on click", () => {
    renderBell({ notificaciones: [makeNotificacion()] });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByText("Tu membresía vence pronto.")).toBeInTheDocument();
    expect(screen.getByText("Membresía próxima a vencer")).toBeInTheDocument();
  });

  // INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): the guardian's
  // linking notice is about a minor's custody — it must read at least as
  // clearly as a payment notice, not fall back to a blank title because the
  // frontend's type map never learned about it.
  it("shows a real title for VINCULACION_REPRESENTANTE, not a blank one", () => {
    renderBell({
      notificaciones: [
        makeNotificacion({
          tipo: "VINCULACION_REPRESENTANTE",
          mensaje: "Lucas Vega (cédula 1712345678) fue vinculado a otra cuenta de representante.",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByText("Lucas Vega (cédula 1712345678) fue vinculado a otra cuenta de representante.")).toBeInTheDocument();
    // The blank title this bug produces is `undefined` rendered as text —
    // asserting the real label directly rules that out.
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.getByText(/vinculaci[oó]n/i)).toBeInTheDocument();
  });

  it("calls onMarkRead when an unread notification is clicked", () => {
    const onMarkRead = vi.fn();
    renderBell({ notificaciones: [makeNotificacion({ id: 7, leida: false })], onMarkRead });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));
    fireEvent.click(screen.getByText("Tu membresía vence pronto."));

    expect(onMarkRead).toHaveBeenCalledWith(7);
  });

  it("does not call onMarkRead for an already-read notification", () => {
    const onMarkRead = vi.fn();
    renderBell({ notificaciones: [makeNotificacion({ id: 7, leida: true })], onMarkRead });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));
    fireEvent.click(screen.getByText("Tu membresía vence pronto."));

    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it("shows an empty state when loadError is set and there are no notifications", () => {
    renderBell({ loadError: true });

    fireEvent.click(screen.getByRole("button", { name: /notificaciones/i }));

    expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument();
  });

  // --- Trigger theming (variant prop) ---
  // Header.tsx renders this on a dark `bg-cata-dark/95` topbar; AppShell.tsx
  // renders it on a light `bg-cata-surface` topbar. The trigger's idle/hover
  // colors must branch so the icon stays legible in both contexts.

  it("defaults to dark-topbar trigger styling (Header usage, unchanged)", () => {
    renderBell();

    const trigger = screen.getByRole("button", { name: /notificaciones/i });

    expect(trigger).toHaveClass("text-white/65");
    expect(trigger).not.toHaveClass("text-cata-text/65");
  });

  it("applies light-topbar trigger styling when variant is light (AppShell usage)", () => {
    renderBell({ variant: "light" });

    const trigger = screen.getByRole("button", { name: /notificaciones/i });

    expect(trigger).toHaveClass("text-cata-text/65");
    expect(trigger).not.toHaveClass("text-white/65");
  });
});
