/**
 * «Alumnos del club» — la nómina del entrenador.
 *
 * Hasta ahora la ficha de emergencia solo se alcanzaba desde el paso 2 del
 * asistente de pasar lista: para ver a quién llamar había que entrar a un
 * horario y ponerse a tomar asistencia. Esta pantalla saca ese disparador del
 * asistente y lo pone donde se lo necesita — una lista de gente, un buscador,
 * y un solo botón por renglón.
 *
 * Lo que estas pruebas cuidan, en orden de importancia:
 *   · que el entrenador llegue y vea la nómina;
 *   · que un alumno inscripto en tres horarios sea UNA persona, no tres;
 *   · que el botón abra la ficha de ESE alumno;
 *   · que la puerta siga siendo del entrenador y de nadie más.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import TrainerStudentsPage from "@/app/trainer/students/page";
import { canAccess } from "@/lib/auth-utils";
import type { AlumnoHorario, FichaEmergencia } from "@/services/api";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";
import { useAuth } from "@/contexts/AuthContext";

// La frontera real la prueba `ProtectedRoute.test.tsx`; acá se captura con qué
// roles la monta ESTA pantalla, que es lo único que la pantalla decide.
const mockProtectedRoute = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({
  default: (props: { children: React.ReactNode; allowedRoles: string[] }) => {
    mockProtectedRoute(props.allowedRoles);
    return <>{props.children}</>;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/students",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockFetchRoster = vi.fn();
const mockFetchFichaEmergencia = vi.fn();

vi.mock("@/services/api", () => ({
  fetchRosterDeTodosLosHorarios: () => mockFetchRoster(),
  fetchFichaEmergencia: (personaId: number) => mockFetchFichaEmergencia(personaId),
  fetchNotificaciones: vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 }),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

const mockUseAuth = vi.mocked(useAuth);

// ---------------------------------------------------------------------------
// Fixtures. `horarioDia` en MAYÚSCULAS: es lo que manda `DiaSemana` del
// backend, y el `"lun"` que usa el resto del frontend es otro tipo.
// ---------------------------------------------------------------------------

let filaId = 1;

function fila(
  personaId: number,
  nombre: string,
  edad: number,
  dia: string,
  horaInicio = "18:00:00",
): AlumnoHorario {
  return {
    id: filaId++,
    personaId,
    personaNombreCompleto: nombre,
    edad,
    horarioId: filaId,
    horarioDia: dia,
    horarioHoraInicio: horaInicio,
    horarioHoraFin: "19:00:00",
    fechaAsignacion: "2026-01-15T00:00:00",
  };
}

/** Melany va tres días; Diego y Sofía uno cada uno. Cinco filas, tres personas. */
const PADRON: AlumnoHorario[] = [
  fila(7, "Melany Quimis", 12, "LUNES"),
  fila(7, "Melany Quimis", 12, "MIERCOLES"),
  fila(7, "Melany Quimis", 12, "VIERNES"),
  fila(3, "Diego Mendoza", 15, "MARTES", "17:00:00"),
  fila(9, "Sofía Vera", 14, "SABADO", "09:00:00"),
];

const FICHA: FichaEmergencia = {
  alumnoNombreCompleto: "Melany Quimis",
  tipoSangre: "O_POSITIVO",
  alergias: "Polen",
  contactoEmergencia: "Marta Quimis",
  telefonoEmergencia: "0987654321",
  representanteNombreCompleto: "Marta Quimis",
  representanteTelefono: "0987654321",
};

/** Los renglones de la nómina, sin el resto del andamiaje de la pantalla. */
function renglones(): HTMLElement[] {
  return screen.getAllByTestId(/^student-row-/);
}

beforeEach(() => {
  filaId = 1;
  mockProtectedRoute.mockClear();
  mockFetchRoster.mockReset().mockResolvedValue(PADRON);
  mockFetchFichaEmergencia.mockReset().mockResolvedValue(FICHA);
  mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Ruiz"));
});

describe("un entrenador llega a la pantalla y ve la nómina", () => {
  it("lista a cada alumno con su nombre, su edad y cuándo entrena", async () => {
    render(<TrainerStudentsPage />);

    const melany = await screen.findByTestId("student-row-7");
    expect(within(melany).getByText("Melany Quimis")).toBeInTheDocument();
    expect(melany.textContent).toMatch(/12 años/);
    expect(melany.textContent).toMatch(/Lun 18:00 · Mié 18:00 · Vie 18:00/);
  });

  it("se titula «Alumnos del club» y nunca dice que los alumnos son suyos", async () => {
    // El club no asigna entrenadores a horarios: el backend lo deja escrito en
    // `ficha_medica_router.py`. "Sus alumnos" sería una promesa sin dato detrás.
    render(<TrainerStudentsPage />);

    expect(await screen.findByRole("heading", { name: "Alumnos del club" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sus alumnos/i);
  });

  it("pide el padrón una sola vez, aunque la lista traiga cinco filas", async () => {
    render(<TrainerStudentsPage />);

    await screen.findByTestId("student-row-7");
    expect(mockFetchRoster).toHaveBeenCalledTimes(1);
  });
});

describe("un alumno es una persona, no una asignación", () => {
  it("junta las tres inscripciones de Melany en un solo renglón", async () => {
    render(<TrainerStudentsPage />);

    await screen.findByTestId("student-row-7");
    // Cinco filas entran, tres personas salen.
    expect(renglones()).toHaveLength(3);
    expect(screen.getAllByText("Melany Quimis")).toHaveLength(1);
  });

  it("le pone un solo botón de ficha a cada persona, no uno por horario", async () => {
    render(<TrainerStudentsPage />);

    const melany = await screen.findByTestId("student-row-7");
    expect(within(melany).getAllByRole("button")).toHaveLength(1);
  });
});

describe("la ficha de emergencia es la única acción del renglón", () => {
  it("abre la ficha del alumno cuyo botón se tocó", async () => {
    render(<TrainerStudentsPage />);

    const diego = await screen.findByTestId("student-row-3");
    fireEvent.click(
      within(diego).getByRole("button", { name: /ficha de emergencia de Diego Mendoza/i }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mockFetchFichaEmergencia).toHaveBeenCalledWith(3));
    expect(mockFetchFichaEmergencia).toHaveBeenCalledTimes(1);
  });

  it("no pide ninguna ficha hasta que alguien toca un botón", async () => {
    // 66 alumnos en pantalla no pueden ser 66 lecturas auditadas: el backend
    // registra quién consultó a quién, y precargarlas ensuciaría esa bitácora
    // con consultas que nadie hizo.
    render(<TrainerStudentsPage />);

    await screen.findByTestId("student-row-7");
    expect(mockFetchFichaEmergencia).not.toHaveBeenCalled();
  });
});

describe("el buscador filtra la nómina que ya está en memoria", () => {
  it("deja solo a quien coincide, sin volver a pedir el padrón", async () => {
    render(<TrainerStudentsPage />);
    await screen.findByTestId("student-row-7");

    fireEvent.change(screen.getByRole("searchbox", { name: /buscar/i }), {
      target: { value: "mendoza" },
    });

    await waitFor(() => expect(renglones()).toHaveLength(1));
    expect(screen.getByText("Diego Mendoza")).toBeInTheDocument();
    expect(mockFetchRoster).toHaveBeenCalledTimes(1);
  });

  it("dice que no encontró a nadie en vez de mostrar una lista vacía y muda", async () => {
    render(<TrainerStudentsPage />);
    await screen.findByTestId("student-row-7");

    fireEvent.change(screen.getByRole("searchbox", { name: /buscar/i }), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText(/ningún alumno/i)).toBeInTheDocument();
  });
});

describe("la puerta de la pantalla", () => {
  it("solo la abre para el entrenador", async () => {
    render(<TrainerStudentsPage />);
    await screen.findByTestId("student-row-7");

    expect(mockProtectedRoute).toHaveBeenCalledWith(["trainer"]);
  });

  it("no deja pasar a un alumno, a un representante ni al administrador", async () => {
    render(<TrainerStudentsPage />);
    await screen.findByTestId("student-row-7");

    const permitidos = mockProtectedRoute.mock.calls[0][0];
    // Contra el helper real, no contra la lista escrita a mano: es la misma
    // función que `ProtectedRoute` usa para redirigir.
    expect(canAccess("estudiante", permitidos)).toBe(false);
    expect(canAccess("representante", permitidos)).toBe(false);
    expect(canAccess("admin", permitidos)).toBe(false);
    expect(canAccess("trainer", permitidos)).toBe(true);
  });
});

describe("cuando no hay padrón que mostrar", () => {
  it("dice que el club todavía no inscribió a nadie", async () => {
    mockFetchRoster.mockResolvedValue([]);

    render(<TrainerStudentsPage />);

    expect(await screen.findByText(/todavía no hay alumnos inscriptos/i)).toBeInTheDocument();
  });

  it("ofrece reintentar, sin culpar al entrenador, cuando el padrón no carga", async () => {
    mockFetchRoster.mockRejectedValue(new Error("network boom"));

    render(<TrainerStudentsPage />);

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).not.toMatch(/network|error:|exception|undefined/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});
