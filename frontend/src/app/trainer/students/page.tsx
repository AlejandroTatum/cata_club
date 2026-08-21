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
 * ## Una sola acción por renglón
 *
 * La ficha de emergencia y nada más. Editar un alumno, ver su asistencia o
 * cobrarle son cosas del administrador, y ofrecerlas acá pondría al entrenador
 * a tocar botones que le van a devolver un 403.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookUser, SearchX } from "lucide-react";

import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import {
  BackLink,
  EmptyState,
  ErrorState,
  FilterPanel,
  LoadingState,
  Pagination,
  SearchInput,
} from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { fetchRosterDeTodosLosHorarios, type AlumnoHorario } from "@/services/api";
import { getTotalPages, paginateRecords } from "@/app/attendance/attendance-utils";
import EmergencyCardDialog, {
  type EmergencyCardStudent,
} from "@/app/trainer/attendance/EmergencyCardDialog";
import { agruparAlumnosDelPadron, filtrarPorNombre } from "./students-utils";

/** Diez, como toda lista paginada del producto — ver `list-page-size.test.ts`. */
const PAGE_SIZE = 10;

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
            {nomina.length === 0 ? (
              <EmptyState
                surface="inset"
                icon={<BookUser size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="Todavía no hay alumnos inscriptos"
                description="Cuando la administración asigne alumnos a un horario, van a aparecer acá."
              />
            ) : encontrados.length === 0 ? (
              <EmptyState
                surface="inset"
                icon={<SearchX size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="Ningún alumno coincide con la búsqueda"
                description={`No hay nadie en el padrón que se llame «${busqueda.trim()}». Pruebe con el apellido o con menos letras.`}
              />
            ) : (
              <>
                <ul>
                  {visibles.map((alumno) => (
                    <li
                      key={alumno.personaId}
                      data-testid={`student-row-${alumno.personaId}`}
                      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="truncate text-sm font-semibold text-ink">
                          {alumno.nombreCompleto}
                        </span>
                      </div>

                      {/*
                       * La única acción del renglón, con el mismo alto de pulgar
                       * y el mismo glifo que el disparador del asistente: es la
                       * misma tarjeta, y aprenderla dos veces sería cobrarle al
                       * entrenador la misma lección dos veces.
                       */}
                      <button
                        type="button"
                        onClick={() =>
                          setFichaAbierta({
                            id: alumno.personaId,
                            name: alumno.nombreCompleto,
                          })
                        }
                        aria-label={`Ficha de emergencia de ${alumno.nombreCompleto}`}
                        className="flex h-11 w-11 flex-none items-center justify-center rounded-ctl text-state-bad transition-colors hover:bg-state-bad-bg"
                      >
                        <AlertTriangle size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>

                {/*
                 * Paginación de cliente sobre la nómina ya juntada, porque el
                 * endpoint devuelve el padrón entero de una y no se le va a
                 * pedir que pagine. Se cuentan PERSONAS, no asignaciones: decir
                 * "200 alumnos" cuando hay 66 sería contar tres veces al mismo
                 * chico.
                 */}
                <Pagination
                  page={pagina}
                  totalPages={totalPaginas}
                  onPageChange={setPagina}
                  totalItems={encontrados.length}
                  pageSize={PAGE_SIZE}
                  itemNoun="alumno"
                  variant="footer"
                />
              </>
            )}
          </div>
        )}

        <EmergencyCardDialog student={fichaAbierta} onClose={() => setFichaAbierta(null)} />
      </AppShell>
    </ProtectedRoute>
  );
}
