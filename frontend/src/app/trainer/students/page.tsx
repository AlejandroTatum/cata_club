/**
 * «Alumnos del club» — la nómina del entrenador.
 *
 * Hasta esta pantalla, la ficha de emergencia del issue #360 vivía en UN solo
 * lugar: el paso 2 del asistente de pasar lista. Para saber a quién llamar por
 * un chico lastimado había que elegir un horario, entrar al asistente y
 * ponerse a tomar asistencia de una sesión que quizá no era la de él. Acá el
 * disparador queda donde se lo busca — una lista de personas, un buscador, y
 * un botón por renglón.
 *
 * ## Por qué "del club" y no "sus alumnos"
 *
 * El club NO asigna entrenadores a horarios: cualquier entrenador pasa lista de
 * cualquier sesión, y por eso el permiso de la ficha de emergencia es por DATO
 * y no por pertenencia (`backend/.../ficha_medica_router.py` lo dice con todas
 * las letras: «los alumnos de este entrenador no existe»). No hay dato para
 * recortar el padrón, así que la pantalla muestra el club entero y lo dice en
 * el título. Un posesivo sería una promesa que nada respalda.
 *
 * ## Los cuatro costos del endpoint, y qué hace cada uno acá
 *
 *   · **No pagina.** `GET /groups/horarios/alumnos` devuelve el padrón
 *     agregado completo en una sola llamada. No se le agrega paginación de
 *     servidor: la paginación de esta pantalla es de CLIENTE, sobre la lista ya
 *     traída, en `PAGE_SIZE` renglones como cualquier otra lista del producto.
 *   · **Una fila por asignación.** Un chico en tres horarios llega tres veces;
 *     `agruparAlumnosDelPadron` lo vuelve una persona con sus tres días.
 *   · **No hay bandera de "tiene ficha médica".** No se inventa una. El hueco
 *     —24 de 66 alumnos sin ficha ni representante, medido en el issue #362— se
 *     explica dentro de `EmergencyCardDialog`, que es donde se descubre.
 *   · **No hay dato de a quién le toca cada alumno.** Ver arriba.
 *
 * ## Dos disparadores por renglón, la tabla compartida
 *
 * La ficha de emergencia y el horario — nada más. Editar un alumno, ver su
 * asistencia o cobrarle son cosas del administrador, y ofrecerlas acá pondría
 * al entrenador a tocar botones que le van a devolver un 403. La nómina en sí
 * se dibuja con `ResponsiveListTable`, el mismo shell de `/members`,
 * `/discounts` y el historial de asistencias: tarjeta debajo de `sm`, tabla
 * con encabezados de `sm` para arriba, y un índice que cuenta sobre el padrón
 * filtrado COMPLETO, no sobre la página visible (issue #1156).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookUser, SearchX, Stethoscope } from "lucide-react";

import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import {
  BackLink,
  Button,
  EmptyState,
  ErrorState,
  FilterPanel,
  LoadingState,
  Pagination,
  ResponsiveListTable,
  SearchInput,
  TableCell,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { fetchRosterDeTodosLosHorarios, type AlumnoHorario } from "@/services/api";
import { getTotalPages, paginateRecords } from "@/app/attendance/attendance-utils";
import EmergencyCardDialog, {
  type EmergencyCardStudent,
} from "@/app/trainer/attendance/EmergencyCardDialog";
import {
  agruparAlumnosDelPadron,
  filtrarPorNombre,
  type AlumnoDelClub,
} from "./students-utils";
import ScheduleDialog from "./ScheduleDialog";

/** Diez, como toda lista paginada del producto — ver `list-page-size.test.ts`. */
const PAGE_SIZE = 10;

/**
 * Los dos disparadores del renglón, compartidos por las DOS renderings de
 * `ResponsiveListTable` (tarjeta mobile, celda de tabla de escritorio).
 *
 * El botón entero es el `Button` del sistema. El de ficha médica ya lo era:
 * la MISMA acción que la ficha de Administración (`/members`) — es la misma
 * tarjeta, y aprenderla dos veces sería cobrarle al entrenador la misma
 * lección dos veces — con `Stethoscope` y no `AlertTriangle` porque consulta
 * una ficha, no anuncia un peligro (issue #857), vestido de secundario y no
 * del rojo de peligro (#911), a densidad `md` (`h-ctl`, `ICON.base`) porque
 * el renglón es una lista de pulgar, no una celda de tabla (#911). El de
 * Horario era un `<button>` con clases copiadas a mano; el issue #1156 lo
 * pasa al mismo `Button`, para que los dos disparadores de un renglón se
 * lean y se comporten como lo que son: el mismo componente.
 *
 * `event.currentTarget.focus()` antes de abrir: un toque en el celular no
 * enfoca nada, y la trampa de foco del diálogo guardaría `body` como origen —
 * al cerrar, el entrenador volvería al principio de la página en vez del
 * renglón que estaba mirando.
 */
function BotonFichaMedica({
  alumno,
  onAbrir,
}: {
  alumno: AlumnoDelClub;
  onAbrir: () => void;
}): React.ReactElement {
  return (
    <Button
      variant="secondary"
      className="flex-none"
      onClick={(event) => {
        event.currentTarget.focus();
        onAbrir();
      }}
      aria-label={`Ficha médica de ${alumno.nombreCompleto}`}
    >
      <Stethoscope size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
      Ficha médica
    </Button>
  );
}

function BotonHorario({
  alumno,
  onAbrir,
}: {
  alumno: AlumnoDelClub;
  onAbrir: () => void;
}): React.ReactElement {
  return (
    <Button
      variant="secondary"
      className="flex-none"
      onClick={(event) => {
        event.currentTarget.focus();
        onAbrir();
      }}
      aria-label={`Horario de ${alumno.nombreCompleto}`}
    >
      Horario
    </Button>
  );
}

export default function TrainerStudentsPage(): React.ReactElement {
  const [padron, setPadron] = useState<AlumnoHorario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  /**
   * El alumno cuya ficha está abierta, o `null`. Sale del renglón y entra al
   * diálogo, que recién ahí pide el dato: 66 alumnos en pantalla no pueden ser
   * 66 lecturas auditadas, y el backend registra quién consultó a quién.
   */
  const [fichaAbierta, setFichaAbierta] = useState<EmergencyCardStudent | null>(null);
    const [horarioAbierto, setHorarioAbierto] = useState<{ name: string; horarios: string | null } | null>(null);

  const cargarPadron = useCallback(async (): Promise<void> => {
    setCargando(true);
    setFallo(false);
    try {
      setPadron(await fetchRosterDeTodosLosHorarios());
    } catch (err: unknown) {
      console.error("[trainer/students] fetchRosterDeTodosLosHorarios failed", err);
      setFallo(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarPadron();
  }, [cargarPadron]);

  const nomina = useMemo(() => agruparAlumnosDelPadron(padron), [padron]);
  const encontrados = useMemo(() => filtrarPorNombre(nomina, busqueda), [nomina, busqueda]);
  const totalPaginas = getTotalPages(encontrados.length, PAGE_SIZE);
  const visibles = useMemo(
    () => paginateRecords(encontrados, pagina, PAGE_SIZE),
    [encontrados, pagina],
  );

  /**
   * El número de renglón cuenta sobre el RESULTADO FILTRADO COMPLETO, no
   * sobre la página visible: la fórmula es `(pagina - 1) * PAGE_SIZE + i +
   * 1`. Contar desde `visibles` haría que la página 2 volviera a arrancar
   * en 1, y el número dejaría de decir en qué posición del padrón está uno
   * parado (issue #1156).
   */
  const visiblesConNumero = useMemo(
    () => visibles.map((alumno, i) => ({ alumno, numero: (pagina - 1) * PAGE_SIZE + i + 1 })),
    [visibles, pagina],
  );

  /**
   * Cuál de los dos vacíos aplica, si aplica alguno — nunca ambos: un padrón
   * vacío ya explica por qué no hay resultados, así que la búsqueda ni se
   * evalúa. Statement independiente en vez de ternario anidado en el JSX
   * (S3358): la decisión se toma acá arriba, una sola vez, y el render de
   * abajo solo pregunta "¿hay estado vacío o no?".
   */
  let estadoVacio: { icon: React.ReactElement; title: string; description: string } | null = null;
  if (nomina.length === 0) {
    estadoVacio = {
      icon: <BookUser size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />,
      title: "Todavía no hay alumnos inscritos",
      description: "Cuando la administración asigne alumnos a un horario, van a aparecer acá.",
    };
  } else if (encontrados.length === 0) {
    estadoVacio = {
      icon: <SearchX size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />,
      title: "Ningún alumno coincide con la búsqueda",
      description: `No hay nadie en el padrón que se llame «${busqueda.trim()}». Pruebe con el apellido o con menos letras.`,
    };
  }

  /**
   * Escribir en el buscador vuelve a la página 1.
   *
   * Sin esto, filtrar desde la página 4 deja al entrenador mirando una lista
   * vacía con resultados que sí existen: la página que estaba abierta ya no
   * cae dentro de lo encontrado.
   */
  function buscar(termino: string): void {
    setBusqueda(termino);
    setPagina(1);
  }

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      <AppShell
        title="Alumnos del club"
        subtitle="El padrón completo, con la ficha de emergencia de cada chico a un toque."
      >
        <BackLink href="/trainer" />

        {/*
         * El buscador va en el panel, no suelto sobre el lienzo: es el único
         * control de filtro de la pantalla, y `FilterPanel` es el marco que el
         * producto ya usa para los cinco que filtran. `row` porque el panel
         * ocupa el ancho de la página, no una columna lateral.
         */}
        <FilterPanel
          label="Filtro de la nómina"
          layout="row"
          search={
            <SearchInput
              value={busqueda}
              onChange={buscar}
              label="Buscar un alumno por nombre"
              placeholder="Buscar por nombre"
            />
          }
        />

        {cargando && <LoadingState label="Cargando el padrón del club…" />}

        {fallo && !cargando && (
          <ErrorState
            title="No se pudo cargar el padrón"
            // El mensaje del fetch no se muestra: "Failed to fetch" no le dice
            // nada a nadie parado al borde de una cancha.
            message="Revise su conexión e intente nuevamente."
            onRetry={() => void cargarPadron()}
          />
        )}

        {!cargando && !fallo && (
          <div className="card overflow-hidden">
            {estadoVacio ? (
              <EmptyState
                surface="inset"
                icon={estadoVacio.icon}
                title={estadoVacio.title}
                description={estadoVacio.description}
              />
            ) : (
              <>
                    {/*
                     * La nómina es la MISMA tabla compartida que `/members`,
                     * `/discounts` y el historial de asistencias: tarjetas
                     * debajo de `sm`, tabla con `<thead>` de `sm` para arriba
                     * (issue #1156). El `<ul>` hecho a mano se jubila.
                     */}
                    <ResponsiveListTable
                      items={visiblesConNumero}
                      getKey={({ alumno }) => alumno.personaId}
                      mobileListTestId="students-mobile-list"
                      desktopTableTestId="students-desktop-table"
                      tableHead={
                        <TableRow>
                          <TableHeaderCell type="number">#</TableHeaderCell>
                          <TableHeaderCell>Estudiante</TableHeaderCell>
                          <TableHeaderCell type="action">Ficha médica</TableHeaderCell>
                          <TableHeaderCell type="action">Horario</TableHeaderCell>
                        </TableRow>
                      }
                      renderCard={({ alumno, numero }) => (
                        <li
                          data-testid={`student-card-${alumno.personaId}`}
                          className="space-y-section px-4 py-4"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="flex-none text-2xs tracking-flat text-ink-3">
                              #{numero}
                            </span>
                            {/*
                             * Las tres clases de #664 en el MISMO elemento que
                             * el nombre: `truncate` es `overflow:hidden` +
                             * `nowrap`, y `overflow` no aplica a un elemento
                             * en línea no reemplazado — si el nombre no ES el
                             * ítem flex que se angosta, se derrama debajo de
                             * los botones.
                             */}
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
                              title={alumno.nombreCompleto}
                            >
                              {alumno.nombreCompleto}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <BotonFichaMedica
                              alumno={alumno}
                              onAbrir={() =>
                                setFichaAbierta({ id: alumno.personaId, name: alumno.nombreCompleto })
                              }
                            />
                            <BotonHorario
                              alumno={alumno}
                              onAbrir={() =>
                                setHorarioAbierto({ name: alumno.nombreCompleto, horarios: alumno.horarios })
                              }
                            />
                          </div>
                        </li>
                      )}
                      renderRow={({ alumno, numero }) => (
                        <TableRow data-testid={`student-row-${alumno.personaId}`}>
                          <TableCell type="number">{numero}</TableCell>
                          <TableCell>
                            {/*
                             * El nombre trunca en el MISMO elemento que se
                             * angosta (#664): `block` hace que `overflow`
                             * aplique, `max-w` le da contra qué truncar, y
                             * `title` devuelve el nombre completo al vuelo.
                             */}
                            <span
                              className="block min-w-0 max-w-[240px] flex-1 truncate text-sm font-semibold text-ink"
                              title={alumno.nombreCompleto}
                            >
                              {alumno.nombreCompleto}
                            </span>
                          </TableCell>
                          <TableCell>
                            <BotonFichaMedica
                              alumno={alumno}
                              onAbrir={() =>
                                setFichaAbierta({ id: alumno.personaId, name: alumno.nombreCompleto })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <BotonHorario
                              alumno={alumno}
                              onAbrir={() =>
                                setHorarioAbierto({ name: alumno.nombreCompleto, horarios: alumno.horarios })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      footer={
                        /*
                         * Paginación de cliente sobre la nómina ya juntada,
                         * porque el endpoint devuelve el padrón entero de una
                         * y no se le va a pedir que pagine. Se cuentan
                         * PERSONAS, no asignaciones: decir "200 alumnos" cuando
                         * hay 66 sería contar tres veces al mismo chico.
                         */
                        <Pagination
                          page={pagina}
                          totalPages={totalPaginas}
                          onPageChange={setPagina}
                          totalItems={encontrados.length}
                          pageSize={PAGE_SIZE}
                          itemNoun="alumno"
                          variant="footer"
                        />
                      }
                    />
              </>
            )}
          </div>
        )}

        <EmergencyCardDialog student={fichaAbierta} onClose={() => setFichaAbierta(null)} />
            <ScheduleDialog student={horarioAbierto} onClose={() => setHorarioAbierto(null)} />
      </AppShell>
    </ProtectedRoute>
  );
}
