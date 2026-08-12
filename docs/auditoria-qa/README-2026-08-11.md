# Auditoría QA de Cata Club — 11 de agosto de 2026

## Contexto de la corrida

- **Entorno:** frontend Next.js en `:3000`, backend FastAPI en `:8000`, PostgreSQL en `:5433`, Redis y Mailpit en Docker Compose (`cataclub-qa-*`).
- **Base:** 59 alumnos, 307 inscripciones, 500 asistencias y 16 representantes. La base se restauró con `make qa-reset` al finalizar.
- **Actores:** administrador, entrenador, Sebastián (representante con 4 hijos, persona 33) y Ana (alumna autogestionada, persona 8).
- **Método:** recorrido Playwright, requests con `curl` y verificaciones en PostgreSQL (`psql`). Se emitieron 62 findings y se conservaron 39 capturas PNG.

## Veredicto general

La re-verificación no confirma críticos de seguridad abiertos: cuatro de los cinco hallazgos de la familia del 27 de julio están resueltos. El quinto, el reset de contraseña, queda en `CANNOT_TELL` porque Celery está apagado en QA y no se pudo completar el flujo de token y correo.

La brecha a producción todavía no está cerrada. Queda un hallazgo alto de seguridad abierto (TRA-4, sin bloqueo por cuenta), cinco hallazgos de experiencia o interfaz abiertos y un error nuevo de red en la ficha médica. Además, hay tres hallazgos que no pudieron reproducirse y un crítico cuya verificación requiere Celery activo. No hay un bloqueante confirmado abierto, pero el propietario debe decidir si acepta esta deuda y el riesgo de la verificación incompleta.

## Críticos de seguridad de la auditoría del 27 de julio

| # | Hallazgo | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Pago asociado a una membresía ajena | RESOLVED | El backend respondió `403`: «membresía no pertenece a la persona». |
| 2 | Reset de contraseña no revoca sesiones existentes | CANNOT_TELL | La recuperación respondió `200`, pero Celery está apagado en QA: no se generó token ni correo para completar la comprobación. Requiere re-verificación con Celery activo, preferentemente en producción. |
| 3 | Suspender una cuenta no revoca tokens | RESOLVED | El token viejo de Ana respondió `401` en `/me` después de suspender la cuenta. |
| 4 | Quitar un rol no retira los privilegios del token existente | RESOLVED | Después de quitar `REPRESENTANTE`, el token viejo respondió `401`. |
| 8 | Desactivar una persona no revoca tokens | RESOLVED | `version_sesion` pasó de `1` a `2` y el token viejo quedó inválido. |

El estado de esta familia es 4 de 5 verificados como `RESOLVED` y 1 de 5 como `CANNOT_TELL`. No hay un crítico confirmado como `STILL_OPEN`.

## Hallazgos del 10 de agosto re-verificados

| ID | Severidad original | Veredicto | Evidencia |
|---|---|---|---|
| PAG-1 | BLOQUEANTE | CANNOT_REPRODUCE / NEEDS_MANUAL_REPRO | Sebastián recibió `403` al registrar un pago para la persona 23 y no quedó un pago huérfano; la persona 23 es ajena, por lo que ese `403` es esperable. El caso original, representante pagando para su propio alumno cuando falla la subida, no quedó reproducido. |
| TRA-10 | ALTO | RESOLVED | Después de logout, el access token viejo respondió `401` en `/me` y el refresh token viejo también respondió `401`. |
| TRA-4 | ALTO | STILL_OPEN | Después de 20 contraseñas incorrectas no hubo `429`; el intento correcto número 21 respondió `200` inmediatamente. |
| INS-2 | ALTO | RESOLVED | Existe el endpoint para vincular un representado y el `PATCH` no acepta `representante_id` para reasignar de forma arbitraria. |
| INS-3 | ALTO | RESOLVED | El duplicado fue rechazado con `400` y el conteo final quedó en 1. |
| FIC-2 | ALTO | RESOLVED | Se creó el dependiente y quedó asociado un usuario en la base. |
| FIC-5 | ALTO | CANNOT_REPRODUCE | La persona 8 no tenía ficha médica; el `PATCH` respondió `400` y no modificó la base. |
| DSH-2/A3 | ALTO (UI) | RESOLVED | `blankPct` fue `-15` y el `StatGrid` quedó visible. |
| N1 | ALTO (UI) | RESOLVED | La interfaz mostró «Anahi Cedeno Loor» en lugar de «Persona 15». |
| A1 | ALTO (UI) | STILL_OPEN | La captura todavía muestra «1 Horario · 2 Pasar lista · 3 Confirmar». |
| DSH-6 | ALTO (UI) | RESOLVED | Con las requests `/api/*` abortadas, la URL permaneció en `/dashboard` y no expulsó al usuario a `/login`. |
| TRA-6 | MEDIO | RESOLVED | `limit=5` devolvió 5 elementos y el total informado fue 500. |
| TRA-8 | MEDIO | RESOLVED | Las requests de `members` midieron aproximadamente 29–32 ms y las de `payments` 30–41 ms; no hubo una diferencia de 3–4 veces. |
| ASI-2 | MEDIO | STILL_OPEN | Un `POST` sin justificativo respondió `201`; la base quedó con 84 asistencias justificadas y 0 con justificativo. |
| ASI-7 | MEDIO (UI) | STILL_OPEN | Los filtros solo muestran «desde» y «hasta»; no existe filtro por alumno. |
| ASI-8 | MEDIO (UI) | RESOLVED | En viewport `390x844` no hubo superposición (`overlap:false`). |
| DSH-5 | MEDIO (UI) | STILL_OPEN | El foco quedó entre `789–834` y la barra fija ocupa `782–844`; la superposición está confirmada. |
| INS-6 | BAJO | RESOLVED | La asignación respondió `membresiaVencida=true` y `diasVencida=14`. |
| TRA-7 | BAJO | CANNOT_REPRODUCE | `/api/groups` respondió `404` y no hubo subrequests de backend para medir el comportamiento original. |
| INS-1 | BAJO | STILL_OPEN (KNOWN) | La recuperación respondió `200`, pero Mailpit quedó en 0 mensajes tras 5 segundos; Celery está apagado en QA. |
| ASI-6 | BAJO (UI) | RESOLVED | El pie mostró «37 sesiones», no «sesións». |
| DSH-3/A2/A4 | BAJO (UI) | RESOLVED | En `/ayuda` quedó un solo «Volver al inicio». |
| PAG-5 | BAJO (UI) | RESOLVED | Con monto 40, el botón quedó deshabilitado y se mostró el mensaje que explica el múltiplo de 25 dólares. |
| INS-8 | BAJO (UI) | RESOLVED | Con fecha `1800-01-01`, «Siguiente» quedó deshabilitado. |
| A5 | BAJO (UI) | RESOLVED-AMBIGUO | El instructivo muestra 3 pasos y 3 párrafos explicativos. El subagente lo marcó resuelto, pero esa misma estructura es la que A5 describía como problema; el criterio depende de la interpretación del lector. |

Resultado de la familia: 16 `RESOLVED` (incluye `RESOLVED-AMBIGUO`), 6 `STILL_OPEN` y 3 `CANNOT_REPRODUCE`.

## Hallazgos nuevos

### `/student/medical-record` devuelve 404 para Sebastián

Para Sebastián, persona 33, `GET /api/fichas-medicas/persona/37` devolvió `404` al recorrer `/student/medical-record`. Fue el único error nuevo de red detectado en la corrida. Requiere corregir la ruta o confirmar que la pantalla no debe estar disponible para este actor.

## Hallazgos STILL_OPEN restantes

- **TRA-4, alto de seguridad:** arreglar el control de intentos por cuenta con bloqueo o demora creciente y aviso al usuario legítimo; el límite por IP no cubre este caso.
- **ASI-2, medio:** arreglar el flujo de «Justificado» para pedir motivo o evidencia, o aceptar explícitamente que el campo `justificativo` no forma parte del flujo operativo.
- **A1, alto de UI:** arreglar el instructivo del wizard para que describa el flujo real y no presente «Confirmar» como un paso separado si no corresponde.
- **ASI-7, medio de UI:** agregar un filtro de alumno al reporte de asistencia; el backend ya soporta `persona_id`.
- **DSH-5, medio de UI y accesibilidad:** corregir el desplazamiento del foco para que ningún control quede detrás de la barra fija en mobile.
- **INS-1, bajo y conocido de entorno:** re-verificar con Celery activo. Si producción usa el worker previsto, cerrar el hallazgo como limitación de QA; si no, corregir la publicación o entrega del correo.

## Capturas y evidencia cruda

- Capturas PNG por actor: `docs/auditoria-qa/img-2026-08-11/{actor}/`.
- Findings crudos: `docs/auditoria-qa/raw-2026-08-11/findings.jsonl`.
- La corrida emitió 62 findings y 39 capturas PNG.

## Brecha a producción

La brecha se redujo, pero no está cerrada: hay 0 críticos confirmados como abiertos, 1 crítico en `CANNOT_TELL` que requiere Celery activo, 1 hallazgo alto de seguridad abierto (TRA-4), 5 hallazgos de UI/UX abiertos (A1, ASI-7, DSH-5, ASI-2 e INS-1, este último conocido del entorno) y 1 error nuevo de red (`/student/medical-record` con `404`). No hay un bloqueante confirmado en esta corrida, pero el despliegue requiere que el propietario acepte explícitamente la verificación incompleta del reset de contraseña, el lockout pendiente y la deuda de interfaz, o que se corrijan y re-verifiquen antes de producción.
