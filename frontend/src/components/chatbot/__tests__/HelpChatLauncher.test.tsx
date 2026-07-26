/**
 * The assistant must stay reachable WITHOUT a session, and there must be only
 * ONE of it.
 *
 * `POST /chatbot/consultar` is public on the backend, and the questions it
 * answers ("¿cómo inicio sesión?", "¿cuáles son los horarios?") are exactly
 * the ones asked by someone who does not have an account yet. So every public
 * surface keeps an inline trigger where the question is actually asked —
 * beside the WhatsApp button, under the login form, in the wizard header.
 *
 * What changed when the floating launcher came back: this component no longer
 * mounts a panel. It opens the single panel `HelpChatDock` owns. These tests
 * pin that it is a trigger and nothing else — no second conversation, and
 * still no floating action button of its own.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HelpChatLauncher from "../HelpChatLauncher";
import {
  OPEN_HELP_CHAT_EVENT,
  closeHelpChat,
  openHelpChat,
  resetHelpChatForTests,
} from "../help-chat-store";

describe("HelpChatLauncher", () => {
  beforeEach(() => {
    resetHelpChatForTests();
  });

  afterEach(() => {
    resetHelpChatForTests();
  });

  it("asks the dock to open instead of mounting a panel of its own", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_HELP_CHAT_EVENT, listener);

    render(<HelpChatLauncher variant="quiet" />);
    // A second panel is the failure mode this replaced: three components used
    // to own three ChatWidgets that happened to look alike.
    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /asistente/i }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
    window.removeEventListener(OPEN_HELP_CHAT_EVENT, listener);
  });

  it("reports aria-expanded for the panel it no longer owns", () => {
    render(<HelpChatLauncher variant="quiet" />);
    const trigger = screen.getByRole("button", { name: /asistente/i });

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Closed from anywhere — the panel's own X, Escape, another surface.
    act((): void => closeHelpChat());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("follows the shared state even when something else opened the assistant", () => {
    render(<HelpChatLauncher variant="quiet" />);
    const trigger = screen.getByRole("button", { name: /asistente/i });

    act((): void => openHelpChat("Luis Lopez suma 3 ausencias este mes."));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("never renders a floating action button — the trigger is inline", () => {
    const { container } = render(<HelpChatLauncher variant="landing" label="Pregunta al asistente" />);

    const trigger = screen.getByRole("button", { name: "Pregunta al asistente" });
    expect(trigger.className).not.toMatch(/\bfixed\b/);
    // The float belongs to `HelpChatDock`, which measures what is under its
    // corner. An inline trigger that also floated would be the old FAB back.
    expect(container.querySelectorAll("[class*='fixed']")).toHaveLength(0);
  });

  it("borrows the landing's own quiet button so it cannot outrank the WhatsApp CTA", () => {
    render(<HelpChatLauncher variant="landing" />);

    expect(screen.getByRole("button", { name: /asistente/i }).className).toContain(
      "landing-button-quiet",
    );
  });
});
