# Cadena #858 — Gate de activación (correo verificado + alta presencial)

Tracker de la Feature Branch Chain del issue #858. Este PR existe solo para
coordinar la cadena; **no se fusiona** hasta que los hijos estén revisados e
integrados en orden.

## Objetivo

Restringir el acceso a los módulos del club hasta que la cuenta pública cumpla
dos condiciones: correo verificado y primera membresía activada (alta
presencial), preservando el historial de activación y una experiencia limitada
para cuentas pendientes (estado, reenvío de verificación, salir).

## Forecast y decisión de cadena

| Rebanada | Líneas cambiadas (ins+del) | Presupuesto |
|---|---|---|
| Backend (`fix/activation-gate-backend`) | 210 | 210 / 400 |
| Frontend (`fix/activation-gate-frontend`) | 331 | 331 / 400 |
| Tracker (este documento) | ~80 | 80 / 400 |
| **Total del issue** | **~621** | > 400 → cadena |

## Diagrama de dependencias

```text
main
 └── fix/activation-gate            ← 📍 tracker (este PR, draft/no-merge)
      ↑ PR #1 base
      └── fix/activation-gate-backend
           ↑ PR #2 base
           └── fix/activation-gate-frontend
```

- PR #1 (backend): gate en `decodificar_token`, hito `alta_presencial_completada`,
  claims `activacion_completa` en ambos tokens, campos en `/auth/me`.
- PR #2 (frontend): hint grueso en middleware Edge, estado de activación en el
  BFF de sesión, página `/login/activacion` y redirección post-login.

## Plan de validación

- Backend: `uv run pytest` completo contra `db-test` (el gate toca
  `decodificar_token`, dependencia de ~55 endpoints).
- Frontend: suite vitest completa, `next lint`, `tsc --noEmit`.
- Ningún hijo se marca listo sin su rebanada de pruebas enfocadas en verde.

## Fuera de alcance

Modelos, migraciones, pagos, notificaciones/plantillas y áreas Members/Admin
quedan sin cambios. Los roles ADMINISTRADOR y ENTRENADOR no pasan por el gate.
