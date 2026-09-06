/**
 * Busca un descuento por nombre EXACTO en el catálogo completo, paginando
 * con `skip`/`limit` en vez de asumir que entra en una sola página.
 *
 * Por qué hace falta: `GET /descuentos/` (`descuentos_router.py`) no tiene
 * filtro por nombre, y tampoco hay ningún DELETE — la baja del catálogo es
 * SUAVE vía `activo` (PATCH), documentado explícitamente en el propio
 * router ("No hay DELETE: la baja es SUAVE... las aplicaciones históricas
 * referencian al descuento por FK"). Un descuento desactivado sigue
 * contando para la paginación (el listado admin "incluye inactivos a
 * propósito"), así que el catálogo de este entorno de QA compartido solo
 * puede crecer.
 *
 * `DescuentoRepositorio.listar` ordena por `id ASC` sin excepción — el
 * recién creado siempre cae al FINAL del catálogo, nunca en la primera
 * página una vez que el catálogo crece más allá del límite de una sola
 * consulta. Pedir un `limit` más alto no es una salida: 200 ya es el tope
 * duro del backend (`le=200`), y el catálogo de este entorno ya lo superó.
 */
import type { APIRequestContext } from "@playwright/test";

/** Tope duro del backend (`le=200`, descuentos_router.py) — el tamaño de
 *  página más grande que se puede pedir en una sola llamada. */
const LIMITE_POR_PAGINA = 200;

export interface DescuentoBasico {
  id: number;
  nombre: string;
}

/**
 * Recorre el catálogo página por página hasta encontrar `nombre` o agotarlo.
 * `null` si no existe — nunca lanza por "no encontrado", solo por un error
 * real de red/servidor, para que el caller decida cómo reportarlo.
 */
export async function findDiscountByName(
  request: APIRequestContext,
  nombre: string,
): Promise<DescuentoBasico | null> {
  let skip = 0;
  for (;;) {
    const res = await request.get(`/api/descuentos?skip=${skip}&limit=${LIMITE_POR_PAGINA}`);
    if (!res.ok()) {
      throw new Error(`No se pudo leer el catálogo de descuentos (skip=${skip}): ${res.status()}`);
    }
    const body = (await res.json()) as { items: DescuentoBasico[]; total: number };
    const encontrado = body.items.find((d) => d.nombre === nombre);
    if (encontrado) return encontrado;
    if (body.items.length === 0) return null;
    skip += body.items.length;
    if (skip >= body.total) return null;
  }
}
