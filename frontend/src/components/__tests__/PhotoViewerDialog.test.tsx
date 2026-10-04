import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PhotoViewerDialog from "@/components/PhotoViewerDialog";

const FOTO = "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg";

describe("PhotoViewerDialog", () => {
  it("keeps focus where it is when the parent re-renders with a new onClose", () => {
    const { rerender } = render(<PhotoViewerDialog open fotoUrl={FOTO} onClose={() => {}} onChange={vi.fn()} />);
    const change = screen.getByRole("button", { name: "Cambiar foto" });
    change.focus();

    rerender(<PhotoViewerDialog open fotoUrl={FOTO} onClose={() => {}} onChange={vi.fn()} />);

    expect(change).toHaveFocus();
  });

  it("closes through the latest onClose after a re-render", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<PhotoViewerDialog open fotoUrl={FOTO} onClose={first} onChange={vi.fn()} />);
    rerender(<PhotoViewerDialog open fotoUrl={FOTO} onClose={latest} onChange={vi.fn()} />);

    screen.getByRole("button", { name: "Cerrar" }).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it("disables «Cambiar foto» while a photo is uploading", () => {
    render(<PhotoViewerDialog open uploading fotoUrl={FOTO} onClose={vi.fn()} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cambiar foto" })).toBeDisabled();
  });
});
