/**
 * Resolver el `persona_id` propio de una cuenta iniciando sesión como ella
 * (issue de duplicación de SonarCloud): `discount-payment-effect.live.
 * spec.ts` y este módulo necesitan la MISMA resolución -- `/api/members` no
 * sirve para encontrar a Pedro en este entorno (miles de personas de
 * `enrollment-*.live.spec.ts` llenan las 200 filas de esa página, ver el
 * encabezado de `discount-payment-effect.live.spec.ts`), pero la respuesta
 * de `POST /api/auth/login` ya trae el id.
 */

import { request as apiRequestModule, type APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL } from "../e2e-target";

/**
 * Usa un contexto DESCARTABLE, nunca el `request` de admin de un `beforeEach`
 * ni el de `page` -- pisaría la sesión que ambos necesitan después.
 */
export async function personaIdViaOwnLogin(email: string, password: string): Promise<string> {
  const ctx = await apiRequestModule.newContext({ baseURL: E2E_BASE_URL });
  try {
    const res = await ctx.post("/api/auth/login", { data: { email, password } });
    if (!res.ok()) {
      throw new Error(`No se pudo iniciar sesión como ${email} para resolver su persona_id: ${res.status()}`);
    }
    const body = (await res.json()) as { user: { id: string } };
    return body.user.id;
  } finally {
    await ctx.dispose();
  }
}

/**
 * Resuelve la membresía de `personaId` vía `GET /api/student?personaId=`,
 * reusando cualquier `APIRequestContext` ya autenticado (`page.request` o el
 * `request` de un test) -- ese endpoint autoriza tanto al dueño como a un
 * ADMINISTRADOR (`GET /membresias/mias`, backend), así que una sesión de
 * admin ya abierta puede leer la membresía de un tercero sin necesitar una
 * segunda sesión. URL absoluta a propósito: el `request` de nivel de test no
 * trae `baseURL` configurado (a diferencia de `page.request`), mismo criterio
 * que `rejectPendingPayments` en `helpers/pending-payments.ts`.
 */
export async function membresiaIdDe(ctx: APIRequestContext, personaId: string): Promise<number> {
  const res = await ctx.get(`${E2E_BASE_URL}/api/student?personaId=${personaId}`);
  if (!res.ok()) {
    throw new Error(`No se pudo leer la membresía de la persona ${personaId}: ${res.status()}`);
  }
  const body = (await res.json()) as { self: { membership: { id: number } | null } };
  if (!body.self.membership) {
    throw new Error(`La persona ${personaId} no tiene una membresía activa.`);
  }
  return body.self.membership.id;
}
