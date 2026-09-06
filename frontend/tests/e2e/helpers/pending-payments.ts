/**
 * Limpieza de pagos pendientes entre corridas de `qa-live` (issue de
 * duplicación de SonarCloud, PR #1079): `payments.live.spec.ts` y
 * `discount-payment-effect.live.spec.ts` necesitan la MISMA higiene antes de
 * cada test — el backend no deja registrar un segundo pago mientras quede
 * uno `PENDIENTE_VALIDACION` para la misma membresía (no hay DELETE de
 * pagos) — y cada uno tenía su propia copia casi idéntica de esta función.
 *
 * No es el flujo bajo prueba de ningún spec que la llama: es higiene de
 * estado, con el endpoint REAL de validación del administrador
 * (`PUT /api/payments/:id`), una escritura pura en la base que no dispara
 * PDF ni correo.
 */

import type { APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL } from "../e2e-target";

/**
 * Rechaza cualquier pago pendiente previo de `studentFullName`. Tolerante a
 * "no hay nada que limpiar": con la cola vacía, el loop de abajo no hace
 * nada.
 */
export async function rejectPendingPayments(
  request: APIRequestContext,
  adminEmail: string,
  adminPassword: string,
  studentFullName: string,
): Promise<void> {
  const login = await request.post(`${E2E_BASE_URL}/api/auth/login`, {
    data: { email: adminEmail, password: adminPassword },
  });
  if (!login.ok()) {
    throw new Error(`No se pudo iniciar sesión como admin para la limpieza: ${login.status()}`);
  }

  const list = await request.get(`${E2E_BASE_URL}/api/payments`, {
    params: { estadoPago: "PENDIENTE_VALIDACION" },
  });
  if (!list.ok()) {
    throw new Error(`No se pudo leer la cola de pendientes: ${list.status()}`);
  }

  const body = (await list.json()) as { items?: Array<{ id: string; studentName: string }> };
  for (const item of body.items ?? []) {
    if (item.studentName !== studentFullName) continue;
    const rejected = await request.put(`${E2E_BASE_URL}/api/payments/${item.id}`, {
      data: {
        action: "rejected",
        rejectionReason: "Reinicio QA para repetir el flujo de pago",
      },
    });
    if (!rejected.ok()) {
      throw new Error(`No se pudo reiniciar el pago pendiente ${item.id}: ${rejected.status()}`);
    }
  }
}
