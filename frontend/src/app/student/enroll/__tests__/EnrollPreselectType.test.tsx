/**
 * REG-25: the landing buttons («Soy jugador adulto» / «Inscribo a mi hijo»)
 * link here with `?type=`. The wizard preselects Jugador or Representante,
 * skips the «Tipo» step it already answers, and ignores any other value.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { ENROLL_ADULT_HREF, ENROLL_CHILD_HREF } from "@/app/landing/ConversionSections";
import { ENROLLMENT_TYPES, saveEnrollDraft, initialFormData } from "@/app/student/enroll/enroll-utils";

// The wizard's step lives in the query string now. The double is backed by
// jsdom's real history so these tests walk the same URL a browser would.
vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockIsAuthenticated = false;

let mockAuthRole: "admin" | "trainer" | "representante" | "estudiante" | "unsupported" | null = null;
let mockAuthLoading = false;
const mockLogout = vi.fn().mockResolvedValue(undefined);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: mockAuthRole ? { user: { role: mockAuthRole } } : null,
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockAuthLoading,
    // #717: `refreshSession` answers with the session round trip's own
    // `SessionOutcome` — the wizard now reads it to decide whether it may
    // claim the auto-login took. These tests are the happy path, so the
    // browser kept the cookies.
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
    logout: mockLogout,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  // Public tariff catalog shown on step 1 (issue #331) — mocked so the
  // wizard's fetch-on-mount effect resolves instead of hanging in jsdom.
  fetchTarifas: vi.fn().mockResolvedValue([{ categoria: "Categoria Test", precio: "1.00" }]),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));


function stepper(): HTMLElement {
  return screen.getByRole("list", { name: /pasos de la inscripción/i });
}

function openWizardAt(href: string): void {
  resetTestHistory(href);
  render(<EnrollPage />);
}

beforeEach(() => {
  mockIsAuthenticated = false;
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetTestHistory("/");
  window.sessionStorage.clear();
});

describe("EnrollPage ?type= (REG-25)", () => {
  it("«Soy jugador adulto» opens the student step with Jugador chosen (no Representante step)", () => {
    openWizardAt(ENROLL_ADULT_HREF);

    expect(screen.getByRole("heading", { name: "Datos del jugador" })).toBeInTheDocument();
    expect(within(stepper()).queryByText("Representante")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("paso")).toBe("2");
  });

  it("«Inscribo a mi hijo» opens the student step with Representante chosen (the extra step appears)", () => {
    openWizardAt(ENROLL_CHILD_HREF);

    expect(screen.getByRole("heading", { name: "Datos del jugador" })).toBeInTheDocument();
    expect(within(stepper()).getByText("Representante")).toBeInTheDocument();
  });

  it.each([
    ["player", false],
    ["representative", true],
  ])("accepts the alias ?type=%s", (alias, hasRepresentative) => {
    openWizardAt(`/student/enroll?type=${alias}`);

    expect(screen.getByRole("heading", { name: "Datos del jugador" })).toBeInTheDocument();
    expect(Boolean(within(stepper()).queryByText("Representante"))).toBe(hasRepresentative);
  });

  it.each(["", "admin", "SELF", "child%20", "1", "<script>", "self,child", "constructor", "__proto__"])(
    "ignores the unknown value ?type=%s and starts at the Tipo step with nothing chosen for the visitor",
    (value) => {
      openWizardAt(`/student/enroll?type=${value}`);

      expect(screen.getByRole("heading", { name: "Tipo de inscripción" })).toBeInTheDocument();
      expect(within(stepper()).queryByText("Representante")).not.toBeInTheDocument();
      expect(new URLSearchParams(window.location.search).get("paso")).toBeNull();
    },
  );

  it("starts at the Tipo step when there is no ?type= at all", () => {
    openWizardAt("/student/enroll");

    expect(screen.getByRole("heading", { name: "Tipo de inscripción" })).toBeInTheDocument();
  });

  it("does not throw the visitor back to step 2 when the URL already names a step", () => {
    openWizardAt("/student/enroll?type=self&paso=1");

    expect(screen.getByRole("heading", { name: "Tipo de inscripción" })).toBeInTheDocument();
  });

  it("drops ?type= from the address bar once applied, so a later reload does not override a changed choice", () => {
    openWizardAt(ENROLL_CHILD_HREF);

    expect(new URLSearchParams(window.location.search).has("type")).toBe(false);
  });

  it("the landing choice wins over the type saved in an earlier draft", () => {
    saveEnrollDraft({ ...initialFormData, enrollmentType: ENROLLMENT_TYPES.SELF, nombres: "Ana" });

    openWizardAt(ENROLL_CHILD_HREF);

    expect(within(stepper()).getByText("Representante")).toBeInTheDocument();
  });
});
