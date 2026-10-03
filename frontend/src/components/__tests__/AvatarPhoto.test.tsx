/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AvatarPhoto from "@/components/AvatarPhoto";

describe("AvatarPhoto", () => {
  it("renders the photo when there is a URL", () => {
    render(<AvatarPhoto fotoUrl="https://img.test/a.png" initials="AT" />);

    expect(screen.getByRole("img", { name: "Foto de perfil" })).toHaveAttribute("src", "https://img.test/a.png");
  });

  it("falls back to the initials when the image fails to load", () => {
    render(<AvatarPhoto fotoUrl="https://img.test/roto.png" initials="AT" />);

    fireEvent.error(screen.getByRole("img", { name: "Foto de perfil" }));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AT")).toBeInTheDocument();
  });

  it("shows the initials when there is no URL", () => {
    render(<AvatarPhoto fotoUrl={null} initials="AT" />);

    expect(screen.getByText("AT")).toBeInTheDocument();
  });

  it("tries again when the URL changes after a failure", () => {
    const { rerender } = render(<AvatarPhoto fotoUrl="https://img.test/roto.png" initials="AT" />);
    fireEvent.error(screen.getByRole("img"));

    rerender(<AvatarPhoto fotoUrl="https://img.test/nueva.png" initials="AT" />);

    expect(screen.getByRole("img")).toHaveAttribute("src", "https://img.test/nueva.png");
  });
});
