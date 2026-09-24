/**
 * Divergence guard between the help page and the assistant — issue #768.
 *
 * The club's knowledge used to exist as three unsynchronised copies: the
 * assistant's `_FAQ_CONTENIDO`, this page's `faq-content.ts`, and the chat's
 * quick replies. Change a schedule in one and the other two kept answering the
 * old one, confidently. There is a single canonical definition now, but a
 * shared constant only removes the literal-vs-literal drift — it does not
 * remove every way the two surfaces can still disagree (a hand-written row
 * added beside the mapped ones, an answer the page renders but the serialiser
 * drops, a stale mirror of the canonical file inside `frontend/`).
 *
 * So this file compares the two RENDERED representations and nothing else:
 *
 *   · what a human reads — the DOM `/ayuda` actually produces;
 *   · what the model reads — the exact bytes of the system prompt, committed
 *     as `backend/app/servicios_negocio/prompt_sistema.txt` and locked to the
 *     live `SYSTEM_PROMPT` by `backend/tests/test_conocimiento_club.py`.
 *
 * Schedules left this shared definition in #1374: the snapshot must never
 * carry static schedule lines, and the page's schedule answer directs to the
 * landing's live section — guards below fail if either side regresses.
 * Since the #1374 correction the page renders the FAQ and nothing else, so
 * the club-profile blocks are guarded by their ABSENCE: that knowledge stays
 * with the model, not on this screen.
 *
 * Neither side reads the other's source, and neither side reads the canonical
 * JSON: a guard that reads the same definition twice can only ever agree with
 * itself.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AyudaPage from "@/app/ayuda/page";
import { buildUstedRegisterRegex } from "@/lib/__tests__/usted-register-lock";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** The exact string the model is sent, as the backend last serialised it. */
const PROMPT_SNAPSHOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "backend",
  "app",
  "servicios_negocio",
  "prompt_sistema.txt",
);

function systemPrompt(): string {
  return readFileSync(PROMPT_SNAPSHOT, "utf8");
}

/** Collapses the whitespace jsdom introduces between inline elements. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface RenderedEntry {
  question: string;
  answer: string;
}

/**
 * Every accordion question with the panel it controls. The panel is in the DOM
 * whether or not it is open (`hidden`), so nothing has to be clicked to read
 * the answer a visitor would see.
 */
function renderedFaq(root: HTMLElement): RenderedEntry[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button[aria-controls]")).flatMap(
    (trigger): RenderedEntry[] => {
      const panel = root.querySelector(`#${CSS.escape(trigger.getAttribute("aria-controls") ?? "")}`);
      if (!panel) return [];
      return [{ question: normalise(trigger.textContent ?? ""), answer: normalise(panel.textContent ?? "") }];
    },
  );
}

/** The questions the prompt itself carries, as the serialiser writes them. */
function promptQuestions(prompt: string): string[] {
  return prompt
    .split("\n")
    .filter((line): boolean => line.startsWith("P: "))
    .map((line): string => line.slice(3).trim());
}

describe("club knowledge parity — /ayuda vs the system prompt (issue #768)", (): void => {
  it("can see both rendered representations at all", (): void => {
    // Guards the guard: without the snapshot every assertion below is vacuous,
    // and an empty page would make them vacuous the other way round.
    expect(existsSync(PROMPT_SNAPSHOT)).toBe(true);
    expect(systemPrompt().length).toBeGreaterThan(2000);

    const page = render(<AyudaPage />).container;
    expect(renderedFaq(page).length).toBeGreaterThan(0);
  });

  it("carries no static schedule the page no longer shows (#1374)", (): void => {
    // The page's schedule question directs to the landing's live section; the
    // snapshot's old per-category line (`- Categoría (edades): días, de
    // HH:MM a HH:MM.`) would be a second, unsynchronised answer to the same
    // question. The backend suite guards the same contract from its side.
    const offender = systemPrompt()
      .split("\n")
      .find((line): boolean => /^- .+ \(.+\): .+, de \d{2}:\d{2} a \d{2}:\d{2}\.$/.test(line));

    expect(offender).toBeUndefined();
  });

  it("answers every browsable question with the same words the model was given", (): void => {
    const page = render(<AyudaPage />).container;
    const prompt = normalise(systemPrompt());

    for (const entry of renderedFaq(page)) {
      expect(prompt, `question not in the prompt: ${entry.question}`).toContain(entry.question);
      expect(prompt, `answer drifted for: ${entry.question}`).toContain(entry.answer);
    }
  });

  it("hides nothing from the reader that the model was told", (): void => {
    // The other direction. Without it the page could quietly drop a section
    // and stay green while the assistant kept answering from it.
    const page = render(<AyudaPage />).container;
    const onScreen = renderedFaq(page).map((entry): string => entry.question);

    for (const question of promptQuestions(systemPrompt())) {
      expect(onScreen, `the prompt answers a question the page never shows: ${question}`).toContain(
        question,
      );
    }
  });

  it("renders no club facts the correction moved off the page (#1374)", (): void => {
    // The product correction made /ayuda the FAQ alone: the club-profile
    // blocks left the screen. Their facts stay in the snapshot for whatever
    // reads it, but this page must not grow them back silently — a return
    // here is a product decision, not a drive-by render.
    const page = render(<AyudaPage />).container;

    expect(page.querySelectorAll('[data-testid="club-fact"]')).toHaveLength(0);
  });

  it("keeps the whole page in the 'usted' register once the copy moved out of TypeScript", (): void => {
    // `usted-register.test.ts` sweeps `.ts`/`.tsx` sources only. The FAQ copy
    // now lives in JSON, which that sweep cannot see — this reads it back off
    // the rendered page instead, which is stricter than the sweep it replaces.
    const page = render(<AyudaPage />).container;
    const offenders = normalise(page.textContent ?? "")
      .split(/(?<=[.;:!?])\s+/)
      .filter((sentence): boolean => buildUstedRegisterRegex().test(sentence));

    expect(offenders).toEqual([]);
  });
});
