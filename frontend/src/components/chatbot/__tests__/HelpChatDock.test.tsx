/**
 * The floating launcher, and the rule that keeps it from becoming the FAB the
 * product already removed once.
 *
 * The old one was `fixed bottom-5 right-5 h-14 w-14`, mounted unconditionally,
 * and it covered the trainer's sticky attendance commit bar at 390px and the
 * landing's WhatsApp block. The new one yields: it measures what is under its
 * corner and either climbs above it or withdraws. `resolveClearance` is that
 * rule, and it is tested directly — jsdom has no layout, so the DOM probing
 * around it (`elementsFromPoint` over a real `sticky` bar) is verified in the
 * browser at 390×844 and 1440×900 instead.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HelpChatDock, { resolveClearance } from "../HelpChatDock";
import { closeHelpChat, openHelpChat, resetHelpChatForTests } from "../help-chat-store";
import { createAuthenticatedAuth, createUnauthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

beforeEach(() => {
  resetHelpChatForTests();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ reply: "Entrenamos de lunes a sábado." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHelpChatForTests();
});

describe("HelpChatDock — the launcher", () => {
  it("floats on every surface, named after the assistant it opens", () => {
    render(<HelpChatDock />);

    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    expect(launcher.className).toMatch(/\bfixed\b/);
    expect(launcher.className).toMatch(/\bbottom-4\b/);
    expect(launcher.className).toMatch(/\bright-2\b/);
    // 44px on a phone is the touch-target floor; the old FAB was 56px, which
    // is what made it impossible to fit beside anything.
    expect(launcher.className).toMatch(/\bh-11\b/);
  });

  it("carries a focus indicator that survives a light page", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });

    // Never `outline-ball`: #FFD600 is 1.42:1 on white, half of what 2.4.11
    // asks. The two-tone ring keeps a white band and a coal band, so one of
    // them always contrasts against whatever is underneath.
    expect(launcher.className).not.toMatch(/outline-ball/);
    expect(launcher.className).toContain("#FFFFFF");
    expect(launcher.className).toContain("#131316");
  });

  it("opens the panel, and steps aside while it is open", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    expect(launcher).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(launcher);

    expect(screen.getByRole("dialog", { name: /cata-bot/i })).toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    // The panel has its own close control and shares the same corner — a
    // launcher left on top of it would be the only thing it ever covered.
    expect(launcher).toHaveAttribute("tabindex", "-1");
    expect(launcher.className).toContain("opacity-0");
  });

  it("closes on Escape and hands focus back to the launcher", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });

    fireEvent.click(launcher);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(launcher);
  });

  it("mounts exactly one panel however the assistant was reached", () => {
    render(<HelpChatDock />);

    // The sidebar row, the landing block and the wizard header all go through
    // this same event.
    act((): void => openHelpChat());
    expect(screen.getAllByRole("dialog", { name: /cata-bot/i })).toHaveLength(1);

    act((): void => closeHelpChat());
    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
  });

  it("carries the draft a remote trigger sent with it", () => {
    render(<HelpChatDock />);

    act((): void => openHelpChat("Luis Lopez suma 3 ausencias este mes."));

    expect(screen.getByLabelText(/mensaje para cata-bot/i)).toHaveValue(
      "Luis Lopez suma 3 ausencias este mes.",
    );
  });

  it("keeps the quick replies role-scoped now that one panel serves every role", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendez"));
    render(<HelpChatDock />);

    act((): void => openHelpChat());

    expect(screen.getByRole("button", { name: "¿Cómo tomo asistencia?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "¿Cómo valido un pago?" })).not.toBeInTheDocument();
  });

  it("offers a logged-out visitor the questions the FAQ answers without a role", () => {
    render(<HelpChatDock />);

    act((): void => openHelpChat());

    expect(screen.getByRole("button", { name: "¿Cómo inicio sesión?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "¿Cuáles son los horarios?" })).toBeInTheDocument();
  });
});

describe("resolveClearance", () => {
  it("rests in the corner when nothing owns it", () => {
    expect(resolveClearance(0)).toEqual({ lift: 0, withdrawn: false });
    expect(resolveClearance(-8)).toEqual({ lift: 0, withdrawn: false });
  });

  it("climbs over a strip along the bottom edge", () => {
    // Measured: the admin phone tab bar tops out at y=782 of 844 and the
    // launcher rests with its bottom at y=828, so clearing it costs 58.
    expect(resolveClearance(58)).toEqual({ lift: 58, withdrawn: false });
  });

  it("withdraws instead of hovering over a surface that owns the whole bottom", () => {
    // Measured: the trainer's attendance commit bar is 165px tall at 390×844
    // and tops out at y=679, which costs 161. Climbing over it would park the
    // launcher in the middle of the roster the trainer is working through —
    // exactly the occlusion this replaced.
    expect(resolveClearance(161)).toEqual({ lift: 0, withdrawn: true });
  });

  it("draws the line at one tab bar's worth of yielding", () => {
    expect(resolveClearance(96).withdrawn).toBe(false);
    expect(resolveClearance(97).withdrawn).toBe(true);
  });
});
