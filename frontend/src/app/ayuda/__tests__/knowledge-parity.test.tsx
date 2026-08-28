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

interface RenderedSchedule {
  category: string;
  ages: string;
  days: string;
  hours: string;
}

/** The schedule table, read off the page the way a parent reads it. */
function renderedSchedules(root: HTMLElement): RenderedSchedule[] {
  const rows = Array.from(root.querySelectorAll("tbody tr"));
  return rows.map((row): RenderedSchedule => {
    const cells = Array.from(row.querySelectorAll("th, td")).map((cell): string =>
      normalise(cell.textContent ?? ""),
    );
    return { category: cells[0], ages: cells[1], days: cells[2], hours: cells[3] };
  });
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

/** The club facts the page states about itself, one element per fact. */
function renderedClubFacts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('[data-testid="club-fact"]')).map((node): string =>
    normalise(node.textContent ?? ""),
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
    expect(renderedSchedules(page).length).toBeGreaterThan(0);
    expect(renderedFaq(page).length).toBeGreaterThan(0);
    expect(renderedClubFacts(page).length).toBeGreaterThan(0);
  });

  it("states the same training times to a parent and to the model", (): void => {
    const page = render(<AyudaPage />).container;
    const prompt = systemPrompt();

    for (const schedule of renderedSchedules(page)) {
      const line = prompt
        .split("\n")
        .find((candidate): boolean => candidate.startsWith(`- ${schedule.category} (`));

      expect(line, `the prompt never mentions ${schedule.category}`).toBeDefined();
      expect(line, `${schedule.category} audience drifted`).toContain(schedule.ages);
      expect(line, `${schedule.category} days drifted`).toContain(schedule.days);
      expect(line, `${schedule.category} hours drifted`).toContain(schedule.hours);
    }
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

  it("tells a visitor the same thing about the club that it tells the model", (): void => {
    const page = render(<AyudaPage />).container;
    const prompt = normalise(systemPrompt());

    for (const fact of renderedClubFacts(page)) {
      expect(prompt, `club fact not in the prompt: ${fact}`).toContain(fact);
    }
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
