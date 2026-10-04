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
 * con encabezados de `sm` para arriba (issue #1156). Sin columna de número de
 * renglón: no hay nada en la nómina que numerar.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookUser, SearchX, Stethoscope } from "lucide-react";

import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterPanel,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
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
import EmergencyCardDialog, { type EmergencyCardStudent } from "@/app/trainer/attendance/EmergencyCardDialog";
import { agruparAlumnosDelPadron, filtrarPorNombre, type AlumnoDelClub } from "./students-utils";
import ScheduleDialog from "./ScheduleDialog";
import StudentFichaPanel from "./StudentFichaPanel";

/** Diez, como toda lista paginada del producto — ver `list-page-size.test.ts`. */
const PAGE_SIZE = 10;

/** Tailwind's `lg`: from here the ficha is a panel beside the roster, below it a dialog. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** `false` until mounted and whenever `matchMedia` is missing (SSR, jsdom): the dialog is the safe default. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = (): void => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return (): void => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

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
  seleccionado,
  destacado = false,
}: {
  alumno: AlumnoDelClub;
  onAbrir: () => void;
  seleccionado?: boolean;
  /** Desktop: the ficha is the point of the screen, so it wears the primary skin. */
  destacado?: boolean;
}): React.ReactElement {
  return (
    <Button
      variant={destacado ? "primary" : "secondary"}
      className="flex-none"
      onClick={(event) => {
        event.currentTarget.focus();
        onAbrir();
      }}
      aria-label={`Ficha médica de ${alumno.nombreCompleto}`}
      aria-pressed={seleccionado}
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
        event.stopPropagation();
        event.currentTarget.focus();
        onAbrir();
      }}
      aria-label={`Horario de ${alumno.nombreCompleto}`}
    >
      Horario
    </Button>
  );
}

/** `12 años · Lun–Vie 15:00`: who they are and when to find them. */
function descripcion(alumno: AlumnoDelClub): string {
  return alumno.horariosCompactos
    ? `${alumno.edad} años · ${alumno.horariosCompactos}`
    : `${alumno.edad} años`;
}

/** Name (truncating on its own element, #664) over the compact age-and-schedule line. */
function NombreYDetalle({
  alumno,
  soloEdad = false,
}: {
  alumno: AlumnoDelClub;
  /** Desktop: the schedule has its own column, so the line keeps only the age. */
  soloEdad?: boolean;
}): React.ReactElement {
  return (
    <>
      <span
        className="block min-w-0 max-w-[280px] flex-1 truncate text-sm font-semibold text-ink"
        title={alumno.nombreCompleto}
      >
        {alumno.nombreCompleto}
      </span>
      <span className="block text-xs text-ink-3">{soloEdad ? `${alumno.edad} años` : descripcion(alumno)}</span>
    </>
  );
}

export default function TrainerStudentsPage(): React.ReactElement {
  const [padron, setPadron] = useState<AlumnoHorario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  /** The group filter: a categoría código from the roster, or `null` for everyone. */
  const [grupo, setGrupo] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const esEscritorio = useIsDesktop();
  /** The student shown in the side panel (desktop). */
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  /**
   * El alumno cuya ficha está abierta, o `null`. Sale del renglón y entra al
   * diálogo, que recién ahí pide el dato: 66 alumnos en pantalla no pueden ser
   * 66 lecturas auditadas, y el backend registra quién consultó a quién.
   */
  const [fichaAbierta, setFichaAbierta] = useState<EmergencyCardStudent | null>(null);
  const [horarioAbierto, setHorarioAbierto] = useState<{ name: string; horarios: string | null } | null>(
    null,
  );

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
  const grupos = useMemo(() => {
    const cuentas = new Map<string, { etiqueta: string; cuenta: number }>();
    for (const a of nomina) {
      for (const { codigo, etiqueta } of a.categorias) {
        const previa = cuentas.get(codigo);
        cuentas.set(codigo, { etiqueta, cuenta: (previa?.cuenta ?? 0) + 1 });
      }
    }
    return [...cuentas.entries()]
      .map(([valor, { etiqueta, cuenta }]) => ({ valor, etiqueta, cuenta }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  }, [nomina]);
  const encontrados = useMemo(
    () => filtrarPorNombre(nomina, busqueda).filter((a) => grupo === null || a.categorias.some((c) => c.codigo === grupo)),
    [nomina, busqueda, grupo],
  );
  const totalPaginas = getTotalPages(encontrados.length, PAGE_SIZE);
  const seleccionado = useMemo(
    () => nomina.find((a) => a.personaId === seleccionadoId) ?? null,
    [nomina, seleccionadoId],
  );
  const visibles = useMemo(() => paginateRecords(encontrados, pagina, PAGE_SIZE), [encontrados, pagina]);

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
      title: "Todavía no hay jugadores inscritos",
      description: "Cuando la administración asigne jugadores a un horario, van a aparecer aquí.",
    };
  } else if (encontrados.length === 0) {
    estadoVacio = {
      icon: <SearchX size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />,
      title: "Ningún jugador coincide con la búsqueda",
      description: `No hay nadie en el padrón que se llame «${busqueda.trim()}». Prueba con el apellido o con menos letras.`,
    };
  }

  /**
   * Escribir en el buscador vuelve a la página 1.
   *
   * Sin esto, filtrar desde la página 4 deja al entrenador mirando una lista
   * vacía con resultados que sí existen: la página que estaba abierta ya no
   * cae dentro de lo encontrado.
   */
  /** Desktop: fill the side panel. Below `lg`: open the dialog, as before. */
  function abrirFicha(alumno: AlumnoDelClub): void {
    if (esEscritorio) setSeleccionadoId(alumno.personaId);
    else setFichaAbierta({ id: alumno.personaId, name: alumno.nombreCompleto });
  }

  function elegirGrupo(valor: string | null): void {
    setGrupo(valor);
    setPagina(1);
  }

  /** A new page starts at its first row: the buttons sit at the bottom, so the view would stay there. */
  function cambiarPagina(nueva: number): void {
    setPagina(nueva);
    listaRef.current?.scrollIntoView?.({ behavior: "auto", block: "start" });
  }

  function buscar(termino: string): void {
    setBusqueda(termino);
    setPagina(1);
  }

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      <AppShell
        title="Jugadores del club"
        subtitle="El padrón completo, con la ficha de emergencia de cada chico a un toca."
        back={<BackLink href="/trainer" />}
      >
        {/*
         * El buscador va en el panel, no suelto sobre el lienzo: es el único
         * control de filtro de la pantalla, y `FilterPanel` es el marco que el
         * producto ya usa para los cinco que filtran. `row` porque el panel
         * ocupa el ancho de la página, no una columna lateral.
         */}
        <FilterPanel
          label="Filtro de la nómina"
          className="lg:flex-row lg:items-center lg:gap-6"
          search={
            <SearchInput
              value={busqueda}
              onChange={buscar}
              label="Buscar un jugador por nombre"
              placeholder="Buscar por nombre"
            />
          }
          chips={
            grupos.length > 1 ? (
              <div role="group" aria-label="Categoría" className="flex flex-wrap gap-1.5">
                {[
                  { valor: null, etiqueta: "Todos", cuenta: nomina.length },
                  ...grupos,
                ].map(({ valor, etiqueta, cuenta }) => (
                  <button
                    key={etiqueta}
                    type="button"
                    aria-pressed={grupo === valor}
                    aria-label={valor ? `Categoría ${etiqueta}, ${cuenta}` : `Todos, ${cuenta}`}
                    onClick={() => elegirGrupo(valor)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                      grupo === valor
                        ? "border-coal bg-coal text-white"
                        : "border-line-2 bg-paper text-ink-2 hover:border-ink-3"
                    }`}
                  >
                    {etiqueta}
                    <span
                      className={`text-xs tabular-nums ${grupo === valor ? "text-white/70" : "text-ink-3"}`}
                    >
                      {cuenta}
                    </span>
                  </button>
                ))}
              </div>
            ) : undefined
          }
          fields={
            !cargando && !fallo ? (
              <p className="text-sm text-ink-2 lg:ml-auto" aria-live="polite">
                <b className="font-bold tabular-nums text-ink">{encontrados.length}</b>{" "}
                {encontrados.length === 1 ? "jugador" : "jugadores"}
                {encontrados.length !== nomina.length ? ` de ${nomina.length}` : ""}
              </p>
            ) : undefined
          }
        />

        {cargando && <LoadingState label="Cargando el padrón del club…" />}

        {fallo && !cargando && (
          <ErrorState
            title="No se pudo cargar el padrón"
            // El mensaje del fetch no se muestra: "Failed to fetch" no le dice
            // nada a nadie parado al borde de una cancha.
            message="Revisa tu conexión e intenta nuevamente."
            onRetry={() => void cargarPadron()}
          />
        )}

        {!cargando && !fallo && (
          <div className={esEscritorio && !estadoVacio ? PAGE_RAIL : undefined}>
            <div className="flex min-w-0 flex-col gap-page">
            <div ref={listaRef} className="card scroll-mt-4 overflow-hidden">
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
                   * (issue #1156). El `<ul>` hecho a mano se jubila. Una
                   * sola columna de acciones al final (issue #1291): con
                   * dos columnas `type="action"` el layout automático de la
                   * tabla repartía el ancho sobrante entre las tres
                   * columnas, y cada botón flotaba en el borde derecho de
                   * una celda mucho más ancha que él.
                   */}
                  <ResponsiveListTable
                    items={visibles}
                    getKey={(alumno) => alumno.personaId}
                    mobileListTestId="students-mobile-list"
                    desktopTableTestId="students-desktop-table"
                    tableHead={
                      <TableRow>
                        {/* El número de renglón se retiró: ya no numera. */}
                        <TableHeaderCell>Jugador</TableHeaderCell>
                        {/* Sigue en el árbol de accesibilidad porque un
                              `<th>` sin nombre es una columna que un lector
                              de pantalla anuncia en blanco; un encabezado
                              visible "Acciones" no le dice nada a un lector
                              vidente que los botones de abajo no digan ya. */}
                        <TableHeaderCell>Categoría y horario</TableHeaderCell>
                        <TableHeaderCell type="action">
                          <span className="sr-only">Acciones</span>
                        </TableHeaderCell>
                      </TableRow>
                    }
                    renderCard={(alumno) => (
                      <li
                        data-testid={`student-card-${alumno.personaId}`}
                        className="space-y-section px-4 py-4"
                      >
                        {/*
                         * `truncate` es `overflow:hidden` + `nowrap`, y
                         * `overflow` no aplica a un elemento en línea no
                         * reemplazado (#664): `block` lo vuelve un
                         * candidato válido y lo acota al ancho de la
                         * tarjeta.
                         */}
                        <button
                          type="button"
                          className="block w-full min-w-0 text-left"
                          onClick={() => abrirFicha(alumno)}
                        >
                          <NombreYDetalle alumno={alumno} />
                        </button>
                        <div className="flex flex-wrap gap-2">
                          <BotonFichaMedica alumno={alumno} onAbrir={() => abrirFicha(alumno)} />
                          <BotonHorario
                            alumno={alumno}
                            onAbrir={() =>
                              setHorarioAbierto({ name: alumno.nombreCompleto, horarios: alumno.horarios })
                            }
                          />
                        </div>
                      </li>
                    )}
                    renderRow={(alumno) => (
                      <TableRow
                        data-testid={`student-row-${alumno.personaId}`}
                        // On desktop the whole row selects; the name is the keyboard target.
                        onClick={() => abrirFicha(alumno)}
                        className={`cursor-pointer ${
                          esEscritorio && seleccionadoId === alumno.personaId ? "bg-ink/5" : "hover:bg-ink/5"
                        }`}
                      >
                        <TableCell>
                          <button
                            type="button"
                            className="block w-full text-left"
                            onClick={() => abrirFicha(alumno)}
                          >
                            <NombreYDetalle alumno={alumno} soloEdad={esEscritorio} />
                          </button>
                        </TableCell>
                        {/*
                         * The roster payload carries no emergency-data flag (and
                         * one call per row is not an option), so the middle
                         * column shows what the row already knows: group and week.
                         */}
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {alumno.categorias.map((c) => (
                              <Badge key={c.codigo} tone="ok">
                                Categoría {c.etiqueta}
                              </Badge>
                            ))}
                            <Badge>{alumno.horariosCompactos ?? "Sin horario"}</Badge>
                          </div>
                        </TableCell>
                        <TableCell type="action">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <BotonFichaMedica
                              alumno={alumno}
                              onAbrir={() => abrirFicha(alumno)}
                              seleccionado={esEscritorio && seleccionadoId === alumno.personaId}
                              destacado={esEscritorio}
                            />
                            <BotonHorario
                              alumno={alumno}
                              onAbrir={() =>
                                setHorarioAbierto({ name: alumno.nombreCompleto, horarios: alumno.horarios })
                              }
                            />
                          </div>
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
                        onPageChange={cambiarPagina}
                        totalItems={encontrados.length}
                        pageSize={PAGE_SIZE}
                        itemNoun="jugador"
                        itemNounPlural="jugadores"
                        variant="footer"
                      />
                    }
                  />
                </>
              )}
            </div>
            {esEscritorio && !estadoVacio && grupos.length > 0 && (
              <section aria-label="Jugadores por categoría" data-testid="students-by-group" className="card flex flex-col gap-2 p-[18px]">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Jugadores por categoría</h2>
                <ul className="m-0 flex list-none flex-col p-0">
                  {grupos.map(({ valor: codigo, etiqueta, cuenta }) => (
                    <li key={codigo} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => elegirGrupo(codigo)}
                        aria-pressed={grupo === codigo}
                        aria-label={`Filtrar la categoría ${etiqueta}, ${cuenta}`}
                        className="flex min-h-drow w-full items-center justify-between gap-3 text-left text-sm hover:bg-ink/5"
                      >
                        <span className="font-semibold text-ink">Categoría {etiqueta}</span>
                        <span className="text-ink-2">
                          <b className="font-bold tabular-nums text-ink">{cuenta}</b> {cuenta === 1 ? "jugador" : "jugadores"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            </div>
            {esEscritorio && !estadoVacio && (
              <div className="flex min-w-0 flex-col gap-page">
                <StudentFichaPanel student={seleccionado} />
                <InfoPanel title="Cómo usar la nómina">
                  <p>Busca por nombre o filtra por categoría; un jugador en varios horarios aparece una sola vez.</p>
                  <p>Toca el botón «Ficha médica» de un renglón para ver sus datos médicos y a quién llamar en una emergencia.</p>
                  <p>«Horario» muestra los días y horas en que entrena cada jugador.</p>
                </InfoPanel>
              </div>
            )}
          </div>
        )}

        <EmergencyCardDialog student={fichaAbierta} onClose={() => setFichaAbierta(null)} />
        <ScheduleDialog student={horarioAbierto} onClose={() => setHorarioAbierto(null)} />
      </AppShell>
    </ProtectedRoute>
  );
}
