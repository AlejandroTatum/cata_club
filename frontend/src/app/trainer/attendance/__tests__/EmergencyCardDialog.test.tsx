/**
 * EmergencyCardDialog — issue #360.
 *
 * On-demand, single-alumno lookup triggered from the roster (never bundled
 * into the roster fetch itself, so there is no N+1 to guard here: one open
 * is one `fetchFichaEmergencia` call for exactly the alumno the trainer
 * tapped). No confirmation gate on open or close — the issue is explicit
 * that a friction step in an emergency is harm, not protection.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import EmergencyCardDialog, { type EmergencyCardStudent } from "../EmergencyCardDialog";
import { fetchFichaEmergencia, type FichaEmergencia } from "@/services/api";

vi.mock("@/services/api", () => ({
  fetchFichaEmergencia: vi.fn(),
}));

const fichaCompleta: FichaEmergencia = {
  alumnoNombreCompleto: "Iker Solís",
  tipoSangre: "O_POSITIVO",
  alergias: "Polen",
  contactoEmergencia: "Marta Solís",
  telefonoEmergencia: "0987654321",
  representanteNombreCompleto: "Marta Solís",
  representanteTelefono: "0987654321",
};

const fichaSinFichaMedica: FichaEmergencia = {
  alumnoNombreCompleto: "Iker Solís",
  tipoSangre: null,
  alergias: null,
  contactoEmergencia: null,
  telefonoEmergencia: null,
  representanteNombreCompleto: "Marta Solís",
  representanteTelefono: "0987654321",
};

beforeEach(() => {
  vi.mocked(fetchFichaEmergencia).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EmergencyCardDialog", () => {
  it("renders nothing when there is no selected student", () => {
    const { container } = render(
      <EmergencyCardDialog student={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches exactly the tapped student's card, once, when opened", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchFichaEmergencia).toHaveBeenCalledWith(5));
    expect(fetchFichaEmergencia).toHaveBeenCalledTimes(1);
  });

  it("shows the four emergency fields and the representative backup once loaded", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    expect(await screen.findByText("O_POSITIVO")).toBeInTheDocument();
    expect(screen.getByText("Polen")).toBeInTheDocument();
    expect(screen.getAllByText("Marta Solís")).not.toHaveLength(0);
    expect(screen.getAllByText("0987654321").length).toBeGreaterThan(0);
  });

  it("falls back to the representative's contact, without an error, when there is no ficha médica", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaSinFichaMedica);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchFichaEmergencia).toHaveBeenCalled());
    expect(screen.getByText("Marta Solís")).toBeInTheDocument();
    expect(screen.getByText("0987654321")).toBeInTheDocument();
    // No error surface for the missing-ficha case — it is expected data, not a failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a recoverable error, never a system-sounding message, when the fetch fails", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValue(new Error("network boom"));

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).not.toMatch(/network|error:|exception|undefined/i);
  });

  it("retries the same student on the error state's retry action", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(fetchFichaEmergencia).mockResolvedValueOnce(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText("O_POSITIVO")).toBeInTheDocument();
    expect(fetchFichaEmergencia).toHaveBeenCalledTimes(2);
  });

  it("calls onClose on Escape, with no confirmation step", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);
    const onClose = vi.fn();

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={onClose} />);
    await screen.findByText("O_POSITIVO");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from its own close button, with no confirmation step", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);
    const onClose = vi.fn();

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={onClose} />);
    await screen.findByText("O_POSITIVO");

    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /*
   * El cierre por fondo y su contracara viajan juntos a propósito: tocar un
   * teléfono de emergencia para copiarlo no puede cerrar la tarjeta encima.
   * El fondo es hermano del panel, no su contenedor, así que un click adentro
   * no tiene por dónde llegar hasta él — pero eso es una propiedad del árbol,
   * y el árbol se puede cambiar sin querer. Por eso se afirma.
   */
  it("cierra al tocar el fondo, y NO al tocar dentro del panel", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);
    const onClose = vi.fn();

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={onClose} />);
    await screen.findByText("O_POSITIVO");

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("O_POSITIVO"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("emergency-card-backdrop"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /*
   * Issue #362 lo midió contra la base de QA: de 66 alumnos con horario, 24 no
   * tienen ni ficha médica ni representante legal. Para esos 24 el DTO llega
   * con los seis campos en null y la tarjeta salía en blanco — seis renglones
   * que dicen "No registra" y nada que explique por qué ni a quién reclamarle.
   *
   * Eso es peor que inútil: el entrenador abre la ficha en el minuto en que ya
   * es tarde y tiene que deducir solo que el hueco es del club, no del sistema.
   * El diálogo es el único lugar donde se puede decir, porque el padrón no
   * trae bandera de "tiene ficha" y no se va a inventar una.
   */
  it("dice qué falta y a quién pedírselo cuando la ficha llega completamente vacía", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue({
      alumnoNombreCompleto: "Iker Solís",
      tipoSangre: null,
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
      representanteNombreCompleto: null,
      representanteTelefono: null,
    });

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    const vacio = await screen.findByTestId("emergency-card-empty");
    expect(vacio.textContent).toMatch(/ficha médica/i);
    expect(vacio.textContent).toMatch(/representante legal/i);
    // A quién pedírselo. Sin esto el estado vacío solo describe el problema.
    expect(vacio.textContent).toMatch(/secretaría/i);
  });

  it("no confunde el hueco del club con una falla de carga", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue({
      alumnoNombreCompleto: "Iker Solís",
      tipoSangre: null,
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
      representanteNombreCompleto: null,
      representanteTelefono: null,
    });

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await screen.findByTestId("emergency-card-empty");
    // Ni `role="alert"` ni oferta de reintentar: reintentar no trae un dato que
    // nadie cargó, y ofrecerlo manda al entrenador a golpear un botón inútil.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    // Y no quedan seis "No registra" sueltos detrás del mensaje.
    expect(screen.queryByText("No registra")).not.toBeInTheDocument();
  });

  it("sigue mostrando la tarjeta normal mientras quede un solo dato cargado", async () => {
    // El estado vacío es para el vacío TOTAL. Un alumno sin ficha médica pero
    // con representante tiene por dónde avisar, y taparlo con un cartel de
    // "falta todo" sería mentirle al entrenador en la dirección peligrosa.
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaSinFichaMedica);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await screen.findByText("Marta Solís");
    expect(screen.queryByTestId("emergency-card-empty")).not.toBeInTheDocument();
  });

  it("never renders a field the DTO does not carry (id, cédula, fecha de nacimiento, dirección)", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);
    await screen.findByText("O_POSITIVO");

    expect(screen.queryByText(/cédula/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fecha de nacimiento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dirección/i)).not.toBeInTheDocument();
  });
});

/**
 * El diálogo se declara `aria-modal="true"`, y hasta acá esa promesa era falsa:
 * enfocaba "Cerrar" al abrir y cerraba con Escape, pero no tocaba Tab. Un
 * entrenador que navega con teclado salía del modal en el primer Tab y quedaba
 * tabulando el roster de fondo — que sigue en pantalla, detrás de un fondo
 * translúcido — sin señal de que ya no está en la tarjeta.
 *
 * El conjunto enfocable acá NO es fijo: en error hay dos botones (Reintentar y
 * Cerrar), en la carga completa hay uno solo. Por eso el ciclo se prueba en el
 * estado que lo produce, y no contra un arreglo hardcodeado.
 *
 * jsdom no mueve el foco con un keydown de Tab ni implementa el atrapado nativo
 * de `<dialog>`, así que estas pruebas solo pueden pasar si la trampa hace
 * `preventDefault()` y mueve el foco ella misma.
 *
 * Lo que NO se prueba acá es la dirección. Con dos enfocables, avanzar y
 * retroceder caen en el mismo botón — está medido: una trampa que ignora
 * `shiftKey` deja este archivo entero en verde. La dirección se fija en
 * `lib/__tests__/focus-trap.test.tsx`, con tres enfocables, que es el ciclo
 * más corto donde ir y volver no coinciden.
 */
function TrampaHarness(): React.ReactElement {
  const [student, setStudent] = useState<EmergencyCardStudent | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setStudent({ id: 5, name: "Iker Solís" })}>
        Ver ficha
      </button>
      <EmergencyCardDialog student={student} onClose={() => setStudent(null)} />
    </div>
  );
}

describe("EmergencyCardDialog — atrapado de foco", () => {
  function dentroDelDialogo(): boolean {
    return screen.getByRole("dialog").contains(document.activeElement);
  }

  it("Tab cicla hacia adelante y vuelve al primer enfocable sin salir del modal", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValue(new Error("boom"));

    render(<TrampaHarness />);
    fireEvent.click(screen.getByRole("button", { name: /ver ficha/i }));
    await screen.findByRole("alert");

    const reintentar = screen.getByRole("button", { name: /reintentar/i });
    const cerrar = screen.getByRole("button", { name: /cerrar/i });
    expect(cerrar).toHaveFocus();

    // Dos enfocables: un Tab de más prueba que el ciclo da la vuelta.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dentroDelDialogo()).toBe(true);
    expect(reintentar).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dentroDelDialogo()).toBe(true);
    expect(cerrar).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dentroDelDialogo()).toBe(true);
    expect(reintentar).toHaveFocus();
  });

  it("Shift+Tab también cicla sin salir del modal", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValue(new Error("boom"));

    render(<TrampaHarness />);
    fireEvent.click(screen.getByRole("button", { name: /ver ficha/i }));
    await screen.findByRole("alert");

    const reintentar = screen.getByRole("button", { name: /reintentar/i });
    const cerrar = screen.getByRole("button", { name: /cerrar/i });
    expect(cerrar).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dentroDelDialogo()).toBe(true);
    expect(reintentar).toHaveFocus();

    // Desde el primero, hacia atrás, se va al último — no al roster de fondo.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dentroDelDialogo()).toBe(true);
    expect(cerrar).toHaveFocus();
  });

  it("enfoca Cerrar al abrir, lo mantiene con un solo enfocable, y devuelve el foco al cerrar", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<TrampaHarness />);
    const disparador = screen.getByRole("button", { name: /ver ficha/i });
    disparador.focus();
    fireEvent.click(disparador);

    await screen.findByText("O_POSITIVO");
    const cerrar = screen.getByRole("button", { name: /cerrar/i });
    expect(cerrar).toHaveFocus();

    // Cargada, la tarjeta tiene un único enfocable. Que el foco "se quede" en
    // Cerrar no probaría nada — jsdom tampoco lo mueve. Lo que muerde es
    // soltarlo FUERA del panel y exigir que el Tab lo traiga de vuelta.
    disparador.focus();
    expect(dentroDelDialogo()).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dentroDelDialogo()).toBe(true);
    expect(cerrar).toHaveFocus();

    fireEvent.click(cerrar);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(disparador).toHaveFocus();
  });
});
