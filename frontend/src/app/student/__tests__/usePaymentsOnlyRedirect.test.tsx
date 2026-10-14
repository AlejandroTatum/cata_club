/**
 * The redirect that keeps a blocked profile on Payments (#1768, S6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePaymentsOnlyRedirect } from "@/app/student/usePaymentsOnlyRedirect";
import type { StudentProfileSummary } from "@/services/api";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));

let mockRole: string = "estudiante";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "9", role: mockRole } } }),
}));

const PROFILE: StudentProfileSummary = {
  personaId: "42",
  nombres: "Sofía",
  apellidos: "Vera",
  fechaNacimiento: "2014-03-10",
  recentSessions: [],
  membership: null,
  representante: null,
  representanteId: 9,
};

function Probe({ profile }: { profile: StudentProfileSummary | null }): React.ReactElement {
  const redirecting = usePaymentsOnlyRedirect(profile);
  return <p>{redirecting ? "redirigiendo" : "contenido"}</p>;
}

beforeEach(() => {
  mockReplace.mockReset();
  mockRole = "estudiante";
});

describe("usePaymentsOnlyRedirect", () => {
  it("sends a blocked profile to Payments, keeping the profile selected", () => {
    render(<Probe profile={{ ...PROFILE, bloqueadoPorImpago: true }} />);

    expect(screen.getByText("redirigiendo")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/student/payments?alumno=42");
  });

  it("does nothing for a profile that is not blocked", () => {
    render(<Probe profile={{ ...PROFILE, bloqueadoPorImpago: false }} />);

    expect(screen.getByText("contenido")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not lock staff out of their player pages", () => {
    mockRole = "trainer";
    render(<Probe profile={{ ...PROFILE, bloqueadoPorImpago: true }} />);

    expect(screen.getByText("contenido")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
