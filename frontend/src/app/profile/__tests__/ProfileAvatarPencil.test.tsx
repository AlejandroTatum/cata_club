/**
 * The photo control the way WhatsApp does it: a pencil on the avatar itself.
 * With a photo the pencil opens «Ver foto» / «Cambiar foto» and the avatar
 * opens the photo full size; without one there is nothing to view, so the
 * pencil goes straight to the file picker.
 *
 * `IdentityCard` is pure presentation, so it is rendered directly; the page's
 * upload wiring stays covered by ProfilePage.test.tsx.
 */

import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { IdentityCard } from "@/app/profile/ProfileCards";

const FOTO = "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg";

function renderCard({ fotoUrl = null, uploadingFoto = false }: { fotoUrl?: string | null; uploadingFoto?: boolean } = {}) {
  const fotoInputRef = createRef<HTMLInputElement>();
  const view = render(
    <IdentityCard
      name="Ana Torres"
      initials="AT"
      fotoUrl={fotoUrl}
      roleLabel="Administración"
      chips={[]}
      correo="ana@cataclub.test"
      telefonoRow={null}
      facts={[]}
      createdOn={null}
      uploadingFoto={uploadingFoto}
      fotoError={null}
      fotoInputRef={fotoInputRef}
      onFotoChange={vi.fn()}
    />,
  );
  const input = screen.getByTestId("foto-perfil-input") as HTMLInputElement;
  const pickSpy = vi.spyOn(input, "click");
  return { ...view, hero: screen.getByTestId("profile-hero"), pickSpy };
}

describe("IdentityCard — pencil on the avatar to view or change the photo", () => {
  it("puts the pencil on the avatar and drops the separate «Cambiar foto» link", () => {
    const { hero } = renderCard();

    const avatar = within(hero).getByTestId("profile-avatar");
    expect(within(avatar).getByRole("button", { name: "Cambiar foto de perfil" })).toBeInTheDocument();
    expect(within(hero).getAllByRole("button", { name: /cambiar foto/i })).toHaveLength(1);
  });

  it("without a photo, the pencil opens the file picker and nothing offers to view a photo", () => {
    const { hero, pickSpy } = renderCard();

    fireEvent.click(within(hero).getByRole("button", { name: "Cambiar foto de perfil" }));

    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(within(hero).queryByRole("button", { name: /ver foto/i })).not.toBeInTheDocument();
  });

  it("with a photo, the pencil offers «Ver foto» and «Cambiar foto»", () => {
    const { hero, pickSpy } = renderCard({ fotoUrl: FOTO });

    fireEvent.click(within(hero).getByRole("button", { name: "Editar foto de perfil" }));

    const menu = screen.getByRole("menu", { name: "Editar foto de perfil" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Ver foto",
      "Cambiar foto",
    ]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Cambiar foto" }));
    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("«Ver foto» opens the photo full size, and Escape closes it", () => {
    const { hero } = renderCard({ fotoUrl: FOTO });

    fireEvent.click(within(hero).getByRole("button", { name: "Editar foto de perfil" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ver foto" }));

    const dialog = screen.getByRole("dialog", { name: "Foto de perfil" });
    expect(within(dialog).getByRole("img", { name: "Foto de perfil" })).toHaveAttribute("src", FOTO);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tapping the avatar photo opens the viewer, which can change the photo too", () => {
    const { hero, pickSpy } = renderCard({ fotoUrl: FOTO });

    fireEvent.click(within(hero).getByRole("button", { name: "Ver foto de perfil" }));
    const dialog = screen.getByRole("dialog", { name: "Foto de perfil" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar foto" }));
    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the viewer closes from its «Cerrar» button and from a press on the backdrop", () => {
    const { hero } = renderCard({ fotoUrl: FOTO });

    fireEvent.click(within(hero).getByRole("button", { name: "Ver foto de perfil" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(hero).getByRole("button", { name: "Ver foto de perfil" }));
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the pencil and shows a spinner while the photo uploads", () => {
    const { hero, rerender } = renderCard({ fotoUrl: FOTO, uploadingFoto: true });

    const pencil = within(hero).getByRole("button", { name: "Subiendo foto de perfil…" });
    expect(pencil).toBeDisabled();
    expect(within(hero).queryByRole("button", { name: "Editar foto de perfil" })).not.toBeInTheDocument();

    rerender(
      <IdentityCard
        name="Ana Torres"
        initials="AT"
        fotoUrl={FOTO}
        roleLabel="Administración"
        chips={[]}
        correo="ana@cataclub.test"
        telefonoRow={null}
        facts={[]}
        createdOn={null}
        uploadingFoto={false}
        fotoError={null}
        fotoInputRef={createRef<HTMLInputElement>()}
        onFotoChange={vi.fn()}
      />,
    );
    expect(within(hero).getByRole("button", { name: "Editar foto de perfil" })).toBeEnabled();
  });
});

describe("IdentityCard — no second upload from the viewer", () => {
  it("disables the viewer's «Cambiar foto» while a photo is uploading", () => {
    const { hero, pickSpy } = renderCard({ fotoUrl: FOTO, uploadingFoto: true });

    fireEvent.click(within(hero).getByRole("button", { name: "Ver foto de perfil" }));
    const change = within(screen.getByRole("dialog")).getByRole("button", { name: "Cambiar foto" });

    expect(change).toBeDisabled();
    fireEvent.click(change);
    expect(pickSpy).not.toHaveBeenCalled();
  });
});
