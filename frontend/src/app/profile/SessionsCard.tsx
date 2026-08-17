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

import { useEffect, useState } from "react";
import { fetchMisSesiones, type SesionPropia } from "@/services/api";
import { formatDateTime } from "@/lib/format-utils";
import { Badge } from "@/components/ui";

export default function SessionsCard(): React.ReactElement | null {
  const [sesiones, setSesiones] = useState<SesionPropia[]>([]);

  useEffect((): (() => void) => {
    let cancelado = false;
    fetchMisSesiones()
      .then((filas) => {
        if (!cancelado) setSesiones(filas);
      })
      .catch((err: unknown) => {
        // Se registra y se calla: ver el módulo doc. La consola es para quien
        // depura, la pantalla es para quien vino a otra cosa.
        console.error("[profile] fetchMisSesiones failed", err);
        if (!cancelado) setSesiones([]);
      });
    return (): void => {
      cancelado = true;
    };
  }, []);

  // Sin filas no hay tarjeta. Un encabezado sobre una lista vacía es el mismo
  // hueco de antes, ahora con un borde alrededor.
  if (sesiones.length === 0) return null;

  return (
    <section
      data-testid="profile-sessions"
      className="card flex flex-none flex-col overflow-hidden"
    >
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          Sus sesiones
        </h2>
      </div>

      <ul className="m-0 flex list-none flex-col p-0">
        {sesiones.map((sesion) => (
          <li
            key={sesion.id}
            data-testid={`sesion-${sesion.id}`}
            className="flex flex-col gap-y-field border-b border-line px-5 py-3 last:border-b-0"
          >
            <p className="m-0 break-words text-sm font-semibold text-ink">{sesion.dispositivo}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-2xs tracking-flat text-ink-3">
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
    </section>
  );
}
