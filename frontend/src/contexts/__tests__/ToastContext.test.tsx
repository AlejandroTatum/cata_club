/**
 * Unit tests for ToastContext — public useToast() contract, internal
 * useToastState() (consumed by the future ToastContainer), fake-timer
 * auto-dismiss timing, manual close, and unmount timer sweep.
 *
 * @vitest-environment jsdom
 */

import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ToastProvider,
  useToast,
  useToastState,
  toastDurationFor,
  TOAST_DURATION_MS,
  TOAST_MAX_DURATION_MS,
} from "@/contexts/ToastContext";

/**
 * Long enough that the measured dwell time clears the floor: 150 characters
 * at 55ms plus the 1500ms notice window is 9750ms, just under the ceiling.
 */
const LONG_MESSAGE = "x".repeat(150);

function OutsideProviderHarness(): ReactElement {
  useToast();
  return <div>should not render</div>;
}

function Harness(): ReactElement {
  const toast = useToast();
  const { toasts, removeToast } = useToastState();

  return (
    <div>
      <button type="button" onClick={() => toast.showError("Error message")}>
        trigger-error
      </button>
      <button type="button" onClick={() => toast.showSuccess("Success message")}>
        trigger-success
      </button>
      <button
        type="button"
        onClick={() =>
          toast.showToast({ variant: "error", message: "Custom duration", duration: 8000 })
        }
      >
        trigger-custom-duration
      </button>
      <button
        type="button"
        onClick={() =>
          toast.showSuccess("Sesión iniciada", { description: "Le llevamos a su panel." })
        }
      >
        trigger-with-description
      </button>
      <button type="button" onClick={() => toast.showError(LONG_MESSAGE)}>
        trigger-long
      </button>
      <ul>
        {toasts.map((item) => (
          <li key={item.id} data-testid={`toast-${item.id}`}>
            <span data-testid="variant">{item.variant}</span>
            <span data-testid="message">{item.message}</span>
            <span data-testid="description">{item.description ?? ""}</span>
            <button type="button" onClick={() => removeToast(item.id)}>
              close-{item.id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("useToast outside ToastProvider", () => {
  it("throws when called without a ToastProvider ancestor", () => {
    // React logs the thrown render error to console.error even though the
    // exception also propagates to render() itself — silence that expected
    // noise for this one assertion.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<OutsideProviderHarness />)).toThrow(
      "useToast must be used within a ToastProvider",
    );

    consoleErrorSpy.mockRestore();
  });
});

describe("ToastContext", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("showError / showSuccess", () => {
    it("adds an item with variant 'error' and the given message", () => {
      renderHarness();

      fireEvent.click(screen.getByText("trigger-error"));

      expect(screen.getByTestId("variant")).toHaveTextContent("error");
      expect(screen.getByTestId("message")).toHaveTextContent("Error message");
    });

    it("adds an item with variant 'success' and the given message", () => {
      renderHarness();

      fireEvent.click(screen.getByText("trigger-success"));

      expect(screen.getByTestId("variant")).toHaveTextContent("success");
      expect(screen.getByTestId("message")).toHaveTextContent("Success message");
    });
  });

  describe("manual close", () => {
    it("removes the toast immediately and clears its pending auto-dismiss timer", () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      renderHarness();

      fireEvent.click(screen.getByText("trigger-error"));
      expect(screen.queryByTestId("variant")).toBeInTheDocument();

      fireEvent.click(screen.getByText(/^close-/));

      expect(screen.queryByTestId("variant")).not.toBeInTheDocument();
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });

  describe("unmount sweep", () => {
    it("clears all pending timers on provider unmount, no post-unmount removal", () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const { unmount } = renderHarness();

      fireEvent.click(screen.getByText("trigger-error"));
      fireEvent.click(screen.getByText("trigger-success"));

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe("auto-dismiss timing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("does NOT remove the toast at 4499ms", () => {
      renderHarness();
      fireEvent.click(screen.getByText("trigger-error"));

      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
      });

      expect(screen.queryByTestId("variant")).toBeInTheDocument();
    });

    it("removes the toast at exactly 4500ms (TOAST_DURATION_MS)", () => {
      renderHarness();
      fireEvent.click(screen.getByText("trigger-error"));

      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS);
      });

      expect(screen.queryByTestId("variant")).not.toBeInTheDocument();
    });

    it("respects an explicit duration override instead of the default", () => {
      renderHarness();
      fireEvent.click(screen.getByText("trigger-custom-duration"));

      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS);
      });
      expect(screen.queryByTestId("variant")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(8000 - TOAST_DURATION_MS);
      });
      expect(screen.queryByTestId("variant")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// The clarity rework: *"quisiera un toast para todo pero más claro que le
// haga saber al usuario"*. A toast may carry a supporting line, and it stays
// up long enough to read whatever it carries.
// ---------------------------------------------------------------------------

describe("ToastContext — supporting line", () => {
  it("carries an optional description alongside the message", () => {
    renderHarness();

    fireEvent.click(screen.getByText("trigger-with-description"));

    expect(screen.getByTestId("message")).toHaveTextContent("Sesión iniciada");
    expect(screen.getByTestId("description")).toHaveTextContent("Le llevamos a su panel.");
  });

  it("leaves the description undefined when the caller passes one clause", () => {
    renderHarness();

    fireEvent.click(screen.getByText("trigger-error"));

    expect(screen.getByTestId("description")).toHaveTextContent("");
  });
});

describe("toastDurationFor", () => {
  it("floors a short confirmation at the original 4500ms", () => {
    // Anything under ~55 characters reads faster than the floor allows.
    expect(toastDurationFor("Nivel asignado correctamente.")).toBe(TOAST_DURATION_MS);
    expect(toastDurationFor("Error message")).toBe(TOAST_DURATION_MS);
  });

  it("buys more time for longer copy", () => {
    const short = toastDurationFor("Pago aprobado.");
    const long = toastDurationFor(
      "No se pudo conectar con el servidor.",
      "Su sesión sigue activa. Intente nuevamente en unos minutos.",
    );

    expect(long).toBeGreaterThan(short);
  });

  it("counts the description, not only the message", () => {
    const withoutDetail = toastDurationFor(LONG_MESSAGE.slice(0, 100));
    const withDetail = toastDurationFor(LONG_MESSAGE.slice(0, 100), "y algo más que leer");

    expect(withDetail).toBeGreaterThan(withoutDetail);
  });

  it("never lets a toast camp on screen past the ceiling", () => {
    expect(toastDurationFor("y".repeat(5000))).toBe(TOAST_MAX_DURATION_MS);
  });
});

describe("ToastContext — measured dwell time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a long toast up past the floor a short one would have used", () => {
    renderHarness();
    fireEvent.click(screen.getByText("trigger-long"));

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByTestId("variant")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(toastDurationFor(LONG_MESSAGE) - TOAST_DURATION_MS);
    });
    expect(screen.queryByTestId("variant")).not.toBeInTheDocument();
  });
});
