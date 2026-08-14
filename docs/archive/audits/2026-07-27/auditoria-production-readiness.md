# Auditoría de calidad y preparación para producción

**Rama auditada:** `main`  
**Commit auditado:** `5c65e4ed738ed7ea987c877e54e01a79c465a0be` (`5c65e4e`)  
**Fecha:** 27 de julio de 2026  
**Alcance:** calidad de código, calidad de implementación, seguridad, resiliencia y preparación para producción  
**Modalidad:** inspección de solo lectura; no se implementaron correcciones

## Veredicto

**El commit auditado no está listo para producción.**

La base técnica y los controles automatizados son sólidos, pero permanecen tres vulnerabilidades críticas verificadas relacionadas con autorización y revocación de sesiones. Los tests y builds exitosos demuestran preparación mecánica, pero no compensan estos defectos funcionales y de seguridad.

## Hallazgos críticos

### 1. Un pago puede asociarse a una membresía ajena

- **Ubicación:** `backend/app/servicios_negocio/membresia_pago_servicio.py:194-245`
- **Problema:** el servicio autoriza la operación utilizando `persona_id`, pero no comprueba que `membresia_id` pertenezca a esa misma persona.
- **Impacto:** un usuario puede registrar un pago cruzado y, cuando un administrador lo apruebe, activar o modificar la membresía de otra persona. Esto constituye un problema de autorización e integridad financiera.
- **Estado:** confirmado mediante revisión independiente y verificación adversarial.

### 2. Restablecer la contraseña no revoca las sesiones existentes

- **Ubicaciones:**
  - `backend/app/servicios_negocio/auth_servicio.py:294-307`
  - `backend/app/seguridad/gestor_auth.py:98-150`
- **Problema:** el restablecimiento incrementa `version_contrasenia`, mientras que los access y refresh tokens se validan mediante `version_sesion`.
- **Impacto:** un token robado puede continuar funcionando después del cambio de contraseña. El refresh token podría renovar acceso durante hasta siete días.
- **Estado:** confirmado mediante revisión independiente y verificación adversarial.

### 3. Suspender una cuenta no revoca sus tokens

- **Ubicaciones:**
  - `backend/app/servicios_negocio/rol_servicio.py:125-133`
  - `backend/app/seguridad/gestor_auth.py:142-150`
  - `backend/app/servicios_negocio/auth_servicio.py:228-240`
- **Problema:** la suspensión cambia `usuario.activo`, pero no incrementa `version_sesion`. La validación de tokens tampoco rechaza explícitamente usuarios inactivos.
- **Impacto:** una cuenta suspendida conserva sus access tokens y puede continuar renovando el acceso mientras el refresh token siga vigente.
- **Estado:** confirmado mediante revisión independiente y verificación adversarial.

## Hallazgos importantes

### 4. Quitar un rol no retira inmediatamente los privilegios

- **Ubicaciones:**
  - `backend/app/servicios_negocio/rol_servicio.py:90-106`
  - `backend/app/servicios_negocio/gestor_permisos.py:19-22`
- **Problema:** los roles están embebidos en el access token y quitar un rol no invalida la sesión.
- **Impacto:** el usuario conserva los privilegios anteriores hasta que expire el access token, potencialmente durante 60 minutos.

### 5. La aprobación de pagos y la generación de comprobantes no son atómicas

- **Ubicación:** `backend/app/servicios_negocio/membresia_pago_servicio.py:401-403`
- **Problema:** primero se confirma la operación en la base de datos y después se publica la tarea en Celery.
- **Impacto:** si Redis falla después del commit, el pago queda aprobado pero el comprobante puede no generarse. No existe outbox ni reconciliación automática que garantice la recuperación.

### 6. La recuperación de contraseña informa éxito aunque se pierda la solicitud

- **Ubicación:** `backend/app/servicios_negocio/auth_servicio.py:280-292`
- **Problema:** los errores al publicar la tarea de recuperación en Celery se capturan y descartan.
- **Impacto:** el usuario recibe una respuesta exitosa, pero el correo nunca se envía. No existe persistencia, reintento de publicación ni señal operativa del fallo.

### 7. Invariantes financieras vulnerables a concurrencia

- **Áreas afectadas:** pagos pendientes y membresías activas.
- **Problema:** se utiliza el patrón “consultar y luego insertar” sin restricciones equivalentes en PostgreSQL.
- **Impacto:** solicitudes concurrentes pueden crear múltiples pagos pendientes o más de una membresía activa para la misma persona.

## Deuda operativa

- El healthcheck del backend no comprueba la disponibilidad de PostgreSQL ni Redis.
- Faltan correlación de requests, métricas y trazas suficientes para diagnosticar incidentes de extremo a extremo.
- `docker-compose.prod.yml` no completa el contrato de ingress/TLS, límites de recursos y rotación de logs.
- Los reintentos de alertas pueden duplicar notificaciones in-app o correos.
- La API permite que representantes gestionen fichas médicas, pero la interfaz correspondiente continúa restringida a administradores.
- CI utiliza pnpm 9, mientras `frontend/package.json` declara pnpm 10.33.2.
- La ausencia de observabilidad, considerada inicialmente un bloqueo independiente, fue refutada como `BLOCKER` por dos de tres revisores. Se conserva como deuda operativa, no como defecto crítico autónomo.

## Evidencia positiva

Las validaciones se repitieron sobre un worktree aislado fijado al commit auditado.

| Validación | Resultado |
|---|---:|
| Tests backend | 586 aprobados |
| Cobertura backend | 91 % |
| Tests frontend | 2300 aprobados, 3 omitidos |
| Playwright E2E | 13 de 13 aprobados |
| Ruff, ESLint y TypeScript | Aprobados |
| Build frontend y backend | Aprobado |
| Alembic desde una base vacía hasta `head` | Aprobado |
| Configuración Docker Compose de producción | Aprobada |
| Stack productivo | 7 servicios saludables |
| Healthchecks frontend y backend | HTTP 200 |
| Documentación backend en producción | HTTP 404 esperado |

Estos resultados prueban reproducibilidad, calidad mecánica y capacidad de despliegue. No prueban por sí solos que los flujos de autorización, revocación y consistencia distribuida sean seguros.

## Incidencia durante la auditoría

Mientras se ejecutaban las primeras validaciones, otro proceso modificó el worktree original. Esos cambios no se tocaron ni se revirtieron. Para evitar contaminar la evidencia, la inspección y los gates se repitieron sobre worktrees aislados fijados al commit `5c65e4e`.

## Recomendación

Bloquear el despliegue a producción hasta resolver, como mínimo, los hallazgos críticos 1, 2 y 3. Después de las correcciones, repetir una verificación focalizada de:

1. autorización y ownership de pagos;
2. revocación de access y refresh tokens;
3. suspensión y cambios de roles;
4. consistencia entre commits de base de datos y publicación de tareas;
5. concurrencia sobre invariantes financieras.

---

# Adenda — estado posterior al commit auditado

**Fecha:** 28 de julio de 2026
**Motivo:** la auditoría se fijó en `5c65e4e`. Después de ese commit se integraron tres cambios más a `main`. Esta adenda registra qué cambió, qué hallazgo nuevo de la misma clase apareció, y qué queda pendiente. **No corrige ninguno de los siete hallazgos de la auditoría: los siete siguen abiertos.**

## Commits posteriores al auditado

| Commit | Contenido | CI |
|---|---|---|
| `4dc20bd` | Baja lógica de `Persona`: se elimina el borrado duro y se agrega `PATCH /personas/{id}/estado` | Verde |
| `db8af44` | Se borra el residuo muerto del ranking competitivo (4 columnas, campos DTO, comentarios falsos) | Verde |
| `080f19f` | `PATCH /personas/{id}/nivel`: una sola operación idempotente reemplaza asignar y mover | Verde |

Ninguno toca los flujos de pagos, tokens ni roles señalados por la auditoría.

## 8. Desactivar una persona no revoca sus tokens

**Misma clase que el hallazgo crítico 3. Introducido por `4dc20bd`, posterior al commit auditado.**

- **Ubicaciones:**
  - `backend/app/servicios_negocio/persona_servicio.py:173-207` (`cambiar_estado`)
  - `backend/app/seguridad/gestor_auth.py:112`
- **Problema:** `cambiar_estado` desactiva la `Persona` y, si tiene cuenta, también su `Usuario`. El login rechaza a ambos. Pero **no incrementa `version_sesion`**, y la validación de tokens compara el claim `sver` contra `usuario.version_sesion`.
- **Impacto:** una persona dada de baja del club conserva su access token hasta 60 minutos y puede renovar el acceso con su refresh token hasta 7 días. La baja se percibe como inmediata y no lo es.
- **Corrección recomendada:** unificar el criterio con los hallazgos 2 y 3 — toda operación que retire el acceso debe incrementar `version_sesion`. Corregirlas por separado repetirá el defecto en la siguiente vía que se agregue.

## Sobre el punto de deuda operativa relativo a fichas médicas

La observación es correcta y el trabajo está a medias por decisión explícita: `5c65e4e` habilitó en el backend que un representante lea y edite la ficha médica de sus representados, con verificación de pertenencia y pruebas de IDOR. **La interfaz correspondiente no se construyó.** Hasta que exista, la capacidad está disponible en la API pero es inalcanzable para el usuario al que se le concedió.

## Hallazgos abiertos de las revisiones internas

Detectados durante los cambios posteriores, verificados y **deliberadamente no corregidos** por quedar fuera del alcance de cada cambio. Ninguno es un bloqueo de despliegue por sí solo.

| # | Hallazgo | Ubicación |
|---|---|---|
| A | La verificación de `capacidad_maxima` es consultar-y-luego-escribir sin bloqueo: dos alumnos distintos asignados en simultáneo pueden superar el cupo | `ranking_servicio.py` (`_validar_capacidad_disponible`) |
| B | La guarda de «último administrador» tiene la misma forma sin bloqueo: dos desactivaciones concurrentes pueden dejar el club sin ningún administrador | `rol_servicio.py`, `usuario_ficha_repositorio.py` |
| C | Dos sesiones de pytest concurrentes contra un mismo Postgres colisionan en el fixture de esquema compartido. No afecta a CI, que usa un proceso y una base por job | `backend/tests/conftest.py` |
| D | El handler global de `IntegrityError` mapea a 409. Un futuro error de servidor por violación de integridad se presentará como conflicto de cliente; el traceback sí queda registrado | `backend/main.py` |
| E | Al eliminar un campo del contrato, una pestaña abierta con el bundle anterior lo lee ausente y muestra datos incorrectos sin error visible, hasta que recarga | Inherente al despliegue del frontend |

Los hallazgos A y B son la misma forma que el hallazgo 7 de la auditoría, en dominios distintos. Conviene resolverlos con un criterio único y no caso por caso.

## Trabajo comprometido y no ejecutado

Decisiones ya tomadas por el propietario del producto, pendientes de implementación:

1. **Sacar las notificaciones del prefijo `/ranking/*`** a su propio módulo. No son ranking ni nivel: son avisos de membresía, pago e inscripción. Dos rutas de backend, dos directorios de BFF y tres stubs de E2E fijan las rutas actuales.
2. **Renombrar `ranking` a `nivel` en todo el sistema.** `NivelRanking` a `Nivel`, `Ranking` a `NivelAlumno`, `nivel_ranking_id` a `nivel_id`, las rutas `/ranking/*` a `/niveles/*` y la ruta de página `/ranking` a `/niveles`. Requiere migración de tablas y columnas, y debe integrarse en un único commit: separar backend, BFF y cliente es el modo de fallo que este repositorio ya sufrió en otras rutas.
3. **Convertir `Categoria` de enum a tabla**, para que el club pueda crear un horario nuevo sin desplegar código. Reglas a implementar: sin horas duplicadas, sin cruce horario entre horarios, y sin un entrenador asignado a dos horarios simultáneos. Un enum de PostgreSQL no admite valores nuevos en tiempo de ejecución; mientras `Categoria` sea enum, cada horario nuevo es una migración.

## Vigencia de esta auditoría

El veredicto original se mantiene: **el despliegue a producción sigue bloqueado.** Los hallazgos críticos 1, 2 y 3 continúan abiertos, y el hallazgo 8 de esta adenda se suma a la misma familia. Los tres commits posteriores mejoran integridad de datos y mantenibilidad, pero no tocan autorización de pagos ni revocación de sesiones.
