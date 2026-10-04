/**
 * "Tus sesiones" — el historial de accesos, en la columna de identidad.
 *
 * ## Por qué existe
 *
 * `/profile` dejaba ~500px de canvas vacío bajo la tarjeta de identidad en
 * cuentas de staff, y el encabezado de `page.tsx` ya lo tenía medido y
 * abierto: la columna se resolvió para alumnos agregando `MembershipCard`, y
 * para admin y entrenador quedó pendiente.
 *
 * La razón por la que quedó pendiente importa más que el hueco: no quedaba UN
 * campo de `GET /auth/me` sin mostrar. Correo y rol salen dos veces por
 * pedido expreso del dueño; el único sin usar era `fechaNacimiento`. Y esta
 * pantalla ya había retirado dos intentos de rellenar con algo que no era un
 * dato -- el badge "Cuenta activa" ("a badge that cannot vary is a decoration
 * shaped like a status") y el conteo de dispositivos ("showing a number here
 * would be invented, not read").
 *
 * Así que el hueco se cerró trayendo un dato que antes no existía, con su
 * tabla, su endpoint y su migración detrás.
 *
 * ## Contenido de compañía, no la razón de la pantalla
 *
 * Nadie abre `/profile` para leer su historial de sesiones. Por eso la carga
 * es best-effort y aislada: un fallo deja la tarjeta sin renderizar y no
 * toca el resto del perfil -- el mismo trato que `/dashboard` le da a sus
 * cards secundarias. Y por eso NO hay estado de error visible: un panel rojo
 * en la columna de identidad pesaría más que el contenido que reemplaza.
 *
 * ## Privacidad, afirmada de los dos lados
 *
 * `dispositivo` llega como etiqueta ya derivada ("Android · Chrome"), nunca
 * como user-agent crudo, y no hay campo de IP porque el backend no la guarda
 * (ver `soporte_transversal/dispositivo.py`). Esta tarjeta no tiene dónde
 * volcar más aunque el backend cambiara de opinión, y hay un test que lo fija.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMisSesiones, type SesionPropia } from "@/services/api";
import { formatDateTime } from "@/lib/format-utils";
import { Monitor } from "lucide-react";
import { Badge, cn } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { SectionHead } from "./ProfileParts";

/** Rows shown on first load: this device + the most recent other one. */
const FIRST_PAGE = 2;
/** Rows added per "Ver más sesiones". */
const NEXT_PAGE = 5;

/** The caller's own session leads; the stable sort keeps the recency order. */
function actualPrimero(filas: SesionPropia[]): SesionPropia[] {
  return [...filas].sort((a, b) => Number(b.actual) - Number(a.actual));
}

interface SessionsCardProps {
  /** Bump to reload from the first page (e.g. after closing the other sessions). */
  refreshKey?: number;
  /** Inside «Seguridad»: just the list, with no card or header of its own. */
  embedded?: boolean;
}

export default function SessionsCard({ refreshKey = 0, embedded = false }: SessionsCardProps): React.ReactElement | null {
  const [sesiones, setSesiones] = useState<SesionPropia[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  // Full list, only when the backend ignored `limite` and sent everything;
  // paging then happens here instead of in the API.
  const reserva = useRef<SesionPropia[] | null>(null);
  const generacion = useRef(0);

  useEffect((): (() => void) => {
    const contador = generacion;
    const miGeneracion = ++contador.current;
    reserva.current = null;
    fetchMisSesiones({ limite: FIRST_PAGE + 1, desplazamiento: 0 })
      .then((filas) => {
        if (generacion.current !== miGeneracion) return;
        if (filas.length > FIRST_PAGE + 1) {
          const todas = actualPrimero(filas);
          reserva.current = todas;
          setSesiones(todas.slice(0, FIRST_PAGE));
          setHayMas(true);
        } else {
          setSesiones(filas.slice(0, FIRST_PAGE));
          setHayMas(filas.length > FIRST_PAGE);
        }
      })
      .catch((err: unknown) => {
        // Se registra y se calla: ver el módulo doc. La consola es para quien
        // depura, la pantalla es para quien vino a otra cosa.
        console.error("[profile] fetchMisSesiones failed", err);
        if (generacion.current === miGeneracion) {
          setSesiones([]);
          setHayMas(false);
        }
      });
    return (): void => {
      // Invalidates any in-flight response (unmount or refreshKey change).
      contador.current++;
    };
  }, [refreshKey]);

  const verMas = useCallback((): void => {
    const todas = reserva.current;
    if (todas) {
      const siguiente = todas.slice(0, sesiones.length + NEXT_PAGE);
      setSesiones(siguiente);
      setHayMas(todas.length > siguiente.length);
      return;
    }
    const miGeneracion = generacion.current;
    setCargandoMas(true);
    fetchMisSesiones({ limite: NEXT_PAGE + 1, desplazamiento: sesiones.length })
      .then((filas) => {
        if (generacion.current !== miGeneracion) return;
        setSesiones((previas) => {
          const vistas = new Set(previas.map((f) => f.id));
          return [...previas, ...filas.slice(0, NEXT_PAGE).filter((f) => !vistas.has(f.id))];
        });
        setHayMas(filas.length > NEXT_PAGE);
      })
      .catch((err: unknown) => {
        console.error("[profile] fetchMisSesiones (more) failed", err);
      })
      .finally(() => {
        if (generacion.current === miGeneracion) setCargandoMas(false);
      });
  }, [sesiones.length]);

  // Sin filas no hay tarjeta. Un encabezado sobre una lista vacía es el mismo
  // hueco de antes, ahora con un borde alrededor.
  if (sesiones.length === 0) return null;

  return (
    <section
      data-testid="profile-sessions"
      className={embedded ? "flex flex-col border-b border-line" : "card flex flex-none flex-col overflow-hidden"}
    >
      {embedded ? (
        <h3 className="px-5 pt-3.5 text-2xs font-bold uppercase tracking-wide text-ink-3-strong">
          Tus sesiones
        </h3>
      ) : (
        <SectionHead
          title="Tus sesiones"
          icon={<Monitor size={ICON.sm} strokeWidth={1.5} />}
          tone="info"
        />
      )}

      <ul className="m-0 flex list-none flex-col p-0">
        {sesiones.map((sesion) => (
          <li
            key={sesion.id}
            data-testid={`sesion-${sesion.id}`}
            className={cn(
              "flex flex-col gap-y-field border-b border-line px-5 py-3 last:border-b-0",
              sesion.actual && "bg-state-ok-bg/50",
            )}
          >
            <p className="m-0 break-words text-sm font-semibold text-ink">{sesion.dispositivo}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-2xs tracking-flat text-ink-3-strong">
                {formatDateTime(sesion.iniciadaEn)}
              </span>
              {/* "Este equipo" es lo que vuelve legible la lista: con varios
                  accesos vivos bajo el mismo epoch, sin esta marca nadie sabe
                  cuál es el suyo. Lo habilita el claim `sid`. */}
              {sesion.actual && <Badge tone="ok">Este equipo</Badge>}
              {/* Una sesión cerrada no se oculta: es la prueba visible de que
                  "cerrar mis otras sesiones" hizo algo. */}
              {!sesion.vigente && <Badge tone="neutral">Cerrada</Badge>}
            </div>
          </li>
        ))}
      </ul>

      {hayMas && (
        <button
          type="button"
          onClick={verMas}
          disabled={cargandoMas}
          className="border-t border-line px-5 py-3 text-left text-sm font-semibold text-ink-2 hover:text-ink disabled:opacity-60"
        >
          Ver más sesiones
        </button>
      )}
    </section>
  );
}
