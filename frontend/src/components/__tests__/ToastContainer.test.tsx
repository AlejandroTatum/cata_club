/**
 * Component tests for ToastContainer — renders the live toast stack from
 * `ToastProvider`'s internal state, exposes variant-correct ARIA roles,
 * stacks newest-on-top, and wires the manual close button to `removeToast`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";

function Harness(): React.ReactElement {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.showError("Algo salió mal")}>
        Trigger error
      </button>
      <button type="button" onClick={() => toast.showSuccess("Todo bien")}>
        Trigger success
      </button>
      <button
        type="button"
        onClick={() =>
          toast.showSuccess("Hola, Ana", {
            description: "Su sesión quedó iniciada. Le llevamos a su panel.",
          })
        }
      >
        Trigger detailed
      </button>
      <ToastContainer />
    </div>
  );
}

function renderHarness(): void {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("ToastContainer", () => {
  it("renders nothing when there are no toasts", () => {
    renderHarness();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders an error toast with role=alert and the message", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Algo salió mal");
  });

  it("renders a success toast with role=status and the message", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger success"));

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Todo bien");
  });

  it("stacks multiple toasts with the newest rendered first (on top)", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));
    fireEvent.click(screen.getByText("Trigger success"));

    const toasts = [
      ...screen
        .getByRole("alert")
        .ownerDocument.querySelectorAll('[role="alert"], [role="status"]'),
    ];
    expect(toasts).toHaveLength(2);
    // Newest (success) toast is prepended, so it appears first in the DOM.
    expect(toasts[0]).toHaveTextContent("Todo bien");
    expect(toasts[1]).toHaveTextContent("Algo salió mal");
  });

  it("has a keyboard-reachable close button with the expected aria-label", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));

    const toast = screen.getByRole("alert");
    const closeButton = within(toast).getByRole("button", {
      name: "Cerrar notificación",
    });
    expect(closeButton).toBeInTheDocument();
  });

  it("removes the toast immediately when the close button is activated", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));
    const toast = screen.getByRole("alert");
    const closeButton = within(toast).getByRole("button", {
      name: "Cerrar notificación",
    });

    fireEvent.click(closeButton);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the other toast visible when only one is dismissed", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));
    fireEvent.click(screen.getByText("Trigger success"));

    const errorToast = screen.getByRole("alert");
    const closeButton = within(errorToast).getByRole("button", {
      name: "Cerrar notificación",
    });
    fireEvent.click(closeButton);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Todo bien");
  });
});

// ---------------------------------------------------------------------------
// Two audited defects in the toast chrome.
// ---------------------------------------------------------------------------

describe("ToastContainer — announcement and placement", () => {
  it("does not nest a live region inside a live region", () => {
    renderHarness();
    fireEvent.click(screen.getByText("Trigger error"));

    const toast = screen.getByRole("alert");
    const container = toast.parentElement as HTMLElement;

    // The toast itself is already a live region via `role="alert"`. An
    // `aria-live` on the container made assistive tech announce it twice.
    expect(container).not.toHaveAttribute("aria-live");
    expect(toast).toHaveAttribute("role", "alert");
  });

  it("docks to the bottom on a phone so it cannot cover the shell topbar", () => {
    renderHarness();
    fireEvent.click(screen.getByText("Trigger error"));

    const container = screen.getByRole("alert").parentElement as HTMLElement;

    // `top-4 right-4 w-full max-w-sm` spanned a 360px phone edge to edge and
    // sat on top of the topbar's "Menú" button and notification bell.
    expect(container).toHaveClass("bottom-4");
    expect(container).not.toHaveClass("top-4");
    expect(container).toHaveClass("sm:top-4");
  });
});

// ---------------------------------------------------------------------------
// The clarity rework: a toast has to say what happened AND what it means.
// ---------------------------------------------------------------------------

describe("ToastContainer — a toast that explains itself", () => {
  it("renders the supporting line under the message when one was given", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger detailed"));

    const toast = screen.getByRole("status");
    expect(within(toast).getByText("Hola, Ana")).toBeInTheDocument();
    expect(
      within(toast).getByText("Su sesión quedó iniciada. Le llevamos a su panel."),
    ).toBeInTheDocument();
  });

  it("weights the message above its supporting line", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger detailed"));

    const toast = screen.getByRole("status");
    expect(within(toast).getByText("Hola, Ana").className).toContain("font-semibold");
    expect(
      within(toast).getByText("Su sesión quedó iniciada. Le llevamos a su panel.").className,
    ).toContain("font-normal");
  });

  it("renders no second line when the caller passed one clause", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger success"));

    const toast = screen.getByRole("status");
    expect(toast.querySelectorAll("p")).toHaveLength(1);
  });

  it("carries a decorative variant icon so colour is not the only signal", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger error"));

    const icon = screen.getByRole("alert").querySelector("svg[aria-hidden='true']");
    expect(icon).toBeInTheDocument();
  });

  it("keeps the supporting line at full opacity, since dimming it fails AA on the fills", () => {
    renderHarness();

    fireEvent.click(screen.getByText("Trigger detailed"));

    // White at 85% on `.toast-success`'s #15803D measures 4.09:1. The two
    // tiers are separated by weight and size, never by opacity.
    const detail = within(screen.getByRole("status")).getByText(
      "Su sesión quedó iniciada. Le llevamos a su panel.",
    );
    expect(detail.className).not.toMatch(/text-(current|white)\/\d/);
    expect(detail.className).not.toMatch(/\bopacity-\d/);
  });
});

// ---------------------------------------------------------------------------
// A toast that carries an undo.
//
// The usability evaluation's blunt finding was "no existe deshacer en ninguna
// parte". The place to offer it is the toast that reports what just happened,
// because that is the one moment the user is already looking at the outcome —
// but only if it stays on screen long enough to notice it, decide, and reach
// the control.
// ---------------------------------------------------------------------------

describe("ToastContainer — undo action", () => {
  function ActionToaster({ onAction }: { onAction: () => void }): React.ReactElement {
    const { showSuccess } = useToast();
    return (
      <button
        type="button"
        onClick={() =>
          showSuccess("Marcados como presentes", {
            action: { label: "Deshacer", onAction },
          })
        }
      >
        marcar
      </button>
    );
  }

  it("renders the action as a button the user can reach", () => {
    render(
      <ToastProvider>
        <ActionToaster onAction={vi.fn()} />
        <ToastContainer />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "marcar" }));

    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  it("runs the action and dismisses the toast when it is pressed", () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <ActionToaster onAction={onAction} />
        <ToastContainer />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "marcar" }));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    // The offer is spent — leaving it up invites a second, silent undo.
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("does not render an action button for an ordinary toast", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Trigger success" }));

    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });
});
