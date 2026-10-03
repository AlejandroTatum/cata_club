/**
 * FileDropZone — the one accessible file picker of the admin screens.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FileDropZone from "@/components/ui/FileDropZone";

const png = () => new File(["x"], "logo.png", { type: "image/png" });

function setup(file: File | null = null, onFile = vi.fn()) {
  render(<FileDropZone id="f" label="Foto (JPG o PNG)" hint="JPG o PNG · máx. 5 MB" file={file} onFile={onFile} accept="image/jpeg,image/png" />);
  return onFile;
}

describe("FileDropZone", () => {
  it("keeps the native input reachable by its label", () => {
    setup();
    const input = screen.getByLabelText("Foto (JPG o PNG)");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("sr-only");
  });

  it("defaults to «o arrástrela aquí» and lets the caller agree the gender with its noun (ADMB-23)", () => {
    const { unmount } = render(<FileDropZone id="a" label="Foto" hint="h" file={null} onFile={vi.fn()} accept="image/png" />);
    expect(screen.getByText("o arrástrela aquí")).toBeInTheDocument();
    unmount();
    render(<FileDropZone id="b" label="Logo" hint="h" file={null} onFile={vi.fn()} accept="image/png" dropHint="o arrástrelo aquí" />);
    expect(screen.getByText("o arrástrelo aquí")).toBeInTheDocument();
    expect(screen.queryByText("o arrástrela aquí")).not.toBeInTheDocument();
  });

  it("offers a Spanish button that opens the picker, and the hint", () => {
    setup();
    const click = vi.spyOn(screen.getByLabelText("Foto (JPG o PNG)"), "click");
    fireEvent.click(screen.getByRole("button", { name: /Elegir foto/ }));
    expect(click).toHaveBeenCalled();
    expect(screen.getByText("JPG o PNG · máx. 5 MB")).toBeInTheDocument();
  });

  it("reports the file chosen through the native input", () => {
    const onFile = setup();
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [png()] } });
    expect(onFile).toHaveBeenCalledWith(expect.any(File));
  });

  it("reports a dropped file and highlights while dragging over", () => {
    const onFile = setup();
    const zone = screen.getByRole("button", { name: /Elegir foto/ });
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(zone).toHaveAttribute("data-dragging", "false");
    expect(onFile).toHaveBeenCalledWith(expect.any(File));
  });

  it("shows the chosen file name with a Cambiar action", () => {
    setup(png());
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cambiar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Elegir foto/ })).not.toBeInTheDocument();
  });
});
