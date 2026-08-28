/**
 * `useModalFocusTrap` gets its own tests because its only consumer cannot
 * prove it.
 *
 * `EmergencyCardDialog` never renders more than two focusable controls
 * (Reintentar plus Cerrar in the error state, Cerrar alone otherwise), and a
 * two-element cycle is the one length where direction is invisible: modulo 2,
 * stepping +1 and stepping -1 land on the same element. A trap that ignored
 * `shiftKey` entirely passed every Shift+Tab assertion in that dialog's suite —
 * measured, not assumed. Three focusables is the shortest cycle where forward
 * and backward disagree, so the direction is pinned here instead.
 *
 * jsdom moves no focus on a Tab keydown, so every assertion below only holds if
 * the hook calls `preventDefault()` and moves the focus itself.
 */
import { useRef, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useModalFocusTrap } from "@/lib/focus-trap";

interface HarnessProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Omit to let the trap fall back to the panel's first focusable. */
  readonly conFocoInicial?: boolean;
  /** Renders a panel with nothing focusable inside. */
  readonly vacio?: boolean;
}

function Harness({ open, onClose, conFocoInicial, vacio }: HarnessProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const segundoRef = useRef<HTMLButtonElement>(null);

  useModalFocusTrap({
    open,
    onClose,
    panelRef,
    initialFocusRef: conFocoInicial ? segundoRef : undefined,
  });

  return (
    <div>
      <button type="button">Disparador</button>
      {open && (
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Panel">
          {vacio ? (
            <p>Nada que enfocar</p>
          ) : (
            <>
              <button type="button">Uno</button>
              <button type="button" ref={segundoRef}>
                Dos
              </button>
              <button type="button">Tres</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function botones(): { uno: HTMLElement; dos: HTMLElement; tres: HTMLElement } {
  return {
    uno: screen.getByRole("button", { name: "Uno" }),
    dos: screen.getByRole("button", { name: "Dos" }),
    tres: screen.getByRole("button", { name: "Tres" }),
  };
}

function dentroDelPanel(): boolean {
  return screen.getByRole("dialog").contains(document.activeElement);
}

describe("useModalFocusTrap cycles a three-element panel in both directions", () => {
  it("walks forward with Tab and wraps from the last element to the first", () => {
    render(<Harness open onClose={vi.fn()} />);
    const { uno, dos, tres } = botones();
    expect(uno).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dos).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(tres).toHaveFocus();

    // The wrap: from the last focusable, forward is the first — never the
    // page behind an `aria-modal="true"` panel.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(uno).toHaveFocus();
    expect(dentroDelPanel()).toBe(true);
  });

  it("walks backward with Shift+Tab and wraps from the first element to the last", () => {
    render(<Harness open onClose={vi.fn()} />);
    const { uno, dos, tres } = botones();
    expect(uno).toHaveFocus();

    // Backward from the first is the last. This is the assertion a
    // `shiftKey`-blind trap fails and a two-button dialog cannot make.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(tres).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dos).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(uno).toHaveFocus();
    expect(dentroDelPanel()).toBe(true);
  });
});

describe("useModalFocusTrap pulls stray focus back into the panel", () => {
  it("sends Tab to the first focusable and Shift+Tab to the last when focus is outside", () => {
    render(<Harness open onClose={vi.fn()} />);
    const { uno, tres } = botones();
    const fuera = screen.getByRole("button", { name: "Disparador" });

    fuera.focus();
    expect(dentroDelPanel()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(uno).toHaveFocus();

    fuera.focus();
    expect(dentroDelPanel()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(tres).toHaveFocus();
  });

  it("swallows Tab even when the panel holds nothing focusable", () => {
    render(<Harness open vacio onClose={vi.fn()} />);

    // `fireEvent` returns false when the handler called `preventDefault`.
    // Nowhere to move focus to is not a reason to hand Tab back to the page
    // behind the panel.
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
  });
});

describe("useModalFocusTrap handles opening, Escape and closing", () => {
  it("honours initialFocusRef, and falls back to the first focusable without one", () => {
    const { unmount } = render(<Harness open conFocoInicial onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Dos" })).toHaveFocus();
    unmount();

    render(<Harness open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Uno" })).toHaveFocus();
  });

  it("calls onClose on Escape and leaves the closing to the consumer", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    // The hook does not unmount anything — the dialog owns what closing means.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores keys it does not own", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    const { uno } = botones();

    expect(fireEvent.keyDown(document, { key: "Enter" })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(uno).toHaveFocus();
  });

  it("restores focus to the element that was focused before it opened", () => {
    const { rerender } = render(<Harness open={false} onClose={vi.fn()} />);
    const disparador = screen.getByRole("button", { name: "Disparador" });
    disparador.focus();

    rerender(<Harness open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Uno" })).toHaveFocus();

    rerender(<Harness open={false} onClose={vi.fn()} />);
    expect(disparador).toHaveFocus();
  });
});

/**
 * `onCancel={() => setOpen(false)}` in the real dialogs is a fresh function on
 * every parent render — the hook must not treat that as a reason to tear down
 * and rebuild its keydown listener. `panelRef`/`initialFocusRef` come from
 * `useRef` at every real call site, so they are stable; `onClose` is the only
 * dep that changes shape from render to render, which is why it alone is what
 * this harness exercises.
 */
function HarnessConOnCloseInestable(): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const [motivo, setMotivo] = useState("");

  useModalFocusTrap({
    open: true,
    // Same shape as `onCancel={() => setOpen(false)}` in the real dialogs: a
    // new identity every render, never memoized.
    onClose: () => undefined,
    panelRef,
  });

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Panel">
      <button type="button">Presente</button>
      <textarea
        aria-label="Motivo"
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
      />
    </div>
  );
}

describe("useModalFocusTrap keeps focus put across an unstable onClose", () => {
  it("does not send focus back to the panel's first control while the user types", () => {
    render(<HarnessConOnCloseInestable />);
    const motivo = screen.getByLabelText("Motivo");

    motivo.focus();
    expect(motivo).toHaveFocus();

    fireEvent.change(motivo, { target: { value: "a" } });
    fireEvent.change(motivo, { target: { value: "au" } });
    fireEvent.change(motivo, { target: { value: "aus" } });

    expect(motivo).toHaveFocus();
  });
});
