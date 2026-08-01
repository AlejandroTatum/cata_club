/**
 * Component tests for ConfirmDialog — confirm fires onConfirm exactly once,
 * cancel/Escape/backdrop never fire it, and focus moves to the confirm
 * button on open and back to the trigger on close.
 *
 * @vitest-environment jsdom
 */

import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "@/components/ConfirmDialog";

function Harness({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Trigger
      </button>
      <ConfirmDialog
        open={open}
        title="Confirmar acción"
        message="¿Confirma esta acción?"
        variant="danger"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe("ConfirmDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  let trigger: HTMLElement;

  beforeEach(() => {
    onConfirm.mockReset();
    onCancel.mockReset();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    trigger = screen.getByText("Trigger");
  });

  it("does not render when closed", () => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus to confirm on open, and fires onConfirm exactly once", () => {
    trigger.focus();
    fireEvent.click(trigger);

    const confirmButton = screen.getByRole("button", { name: /confirmar/i });
    expect(confirmButton).toHaveFocus();

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancel dismisses without firing onConfirm and returns focus to the trigger", () => {
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it("Escape dismisses without firing onConfirm", () => {
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("backdrop click dismisses without firing onConfirm", () => {
    fireEvent.click(trigger);
    // Backdrop is the dialog's own container, outside the inner panel.
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("exposes dialog a11y attributes: role, aria-modal, aria-labelledby, aria-describedby", () => {
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");
  });
});
