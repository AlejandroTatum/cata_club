/**
 * `useWizardHistory` against a real back stack.
 *
 * The whole point of the change is that the browser's Back button walks the
 * wizard's steps instead of leaving the wizard, so these tests drive jsdom's
 * actual `history.back()` and wait for the real `popstate`. A mocked router
 * would prove nothing here.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWizardHistory } from "../wizard-history";
import { resetTestHistory, useTestSearchParams } from "./next-navigation-double";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance",
  useSearchParams: () => useTestSearchParams(),
}));

const ORDER = ["select-session", "mark-attendance", "confirm"] as const;
type Step = (typeof ORDER)[number];

beforeEach(() => {
  resetTestHistory("/trainer/attendance");
});

afterEach(() => {
  // Unmount before rewriting the URL. Vitest runs `afterEach` hooks in reverse
  // registration order, so testing-library's own cleanup would otherwise run
  // AFTER this one and the reset would notify components that are still
  // mounted — a state update outside `act`.
  cleanup();
  resetTestHistory("/");
});

function renderWizard(maxReachable = ORDER.length - 1) {
  return renderHook(({ max }) => useWizardHistory<Step>(ORDER, max), {
    initialProps: { max: maxReachable },
  });
}

describe("useWizardHistory", () => {
  it("starts on the first step with a clean URL", () => {
    const { result } = renderWizard();

    expect(result.current.step).toBe("select-session");
    expect(window.location.search).toBe("");
  });

  it("writes the step the stepper shows into the URL", () => {
    const { result } = renderWizard();

    act(() => result.current.goToStep("mark-attendance"));

    expect(result.current.step).toBe("mark-attendance");
    expect(window.location.search).toBe("?paso=2");
  });

  it("walks back one step per Back, instead of leaving the wizard", async () => {
    const { result } = renderWizard();

    act(() => result.current.goToStep("mark-attendance"));
    act(() => result.current.goToStep("confirm"));
    expect(result.current.step).toBe("confirm");

    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.step).toBe("mark-attendance"));

    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.step).toBe("select-session"));
  });

  it("preserves query parameters it does not own", () => {
    resetTestHistory("/trainer/attendance?horario=12");
    const { result } = renderWizard();

    act(() => result.current.goToStep("confirm"));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("horario")).toBe("12");
    expect(params.get("paso")).toBe("3");
  });

  it("repairs a URL asking for a step this session cannot show", async () => {
    // A reload straight onto step 3: no roster was ever loaded.
    resetTestHistory("/trainer/attendance?paso=3");
    const { result } = renderWizard(0);

    expect(result.current.step).toBe("select-session");
    await waitFor(() => expect(window.location.search).toBe("?paso=1"));
  });

  it("does not push a history entry when repairing", async () => {
    resetTestHistory("/trainer/attendance?paso=3");
    const before = window.history.length;
    renderWizard(0);

    await waitFor(() => expect(window.location.search).toBe("?paso=1"));
    expect(window.history.length).toBe(before);
  });

  it("re-clamps to the reachable step when the wizard loses its data", async () => {
    const wizard = renderWizard();

    act(() => wizard.result.current.goToStep("confirm"));
    expect(wizard.result.current.step).toBe("confirm");

    // The roster was discarded — step 3 is no longer showable.
    wizard.rerender({ max: 0 });

    expect(wizard.result.current.step).toBe("select-session");
    await waitFor(() => expect(window.location.search).toBe("?paso=1"));
  });

  it("goes back to the first step without leaving a trail on reset", () => {
    const { result } = renderWizard();

    act(() => result.current.goToStep("mark-attendance"));
    const afterPush = window.history.length;

    act(() => result.current.resetToFirstStep());

    expect(result.current.step).toBe("select-session");
    expect(window.location.search).toBe("?paso=1");
    expect(window.history.length).toBe(afterPush);
  });

  it("ignores a request to go to the step it is already on", () => {
    const { result } = renderWizard();

    act(() => result.current.goToStep("mark-attendance"));
    const afterFirst = window.history.length;

    act(() => result.current.goToStep("mark-attendance"));

    expect(window.history.length).toBe(afterFirst);
  });
});
