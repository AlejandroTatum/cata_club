# Pendientes abiertos — Cata Club

- **Fecha:** 5 de agosto de 2026
- **Verificado contra:** `main` en `717787a`
- **Propósito:** una sola lista de lo que sigue abierto, con su evidencia y su
  ubicación, para ir tachando a medida que se resuelve.

## Cómo usar este documento

Cada ítem es una casilla. Al cerrarlo, se marca `[x]` y se agrega el PR o el
commit que lo cerró entre paréntesis. **No se borran los ítems cerrados**: saber
qué ya se resolvió vale tanto como saber qué falta, y es lo que evita volver a
perseguir un defecto que no existe.

Los ítems provienen de tres fuentes, más una exploración directa del código:

| Fuente | Documento |
|---|---|
| Auditoría de producción | `docs/auditoria-production-readiness-main-2026-07-27.md` |
| Hallazgos de la presentación | `docs/hallazgos-post-presentacion.md` |
| Evaluación de usabilidad | `docs/ux/evaluacion-usabilidad-rediseno.md` |
| Exploración del código | 5 de agosto de 2026 |

La severidad indica **consecuencia**, no esfuerzo:

| Severidad | Significado |
|---|---|
| **Bloqueante** | Produce datos incorrectos, pérdida de dinero o incumplimiento verificable |
| **Alta** | Falla en producción sin que nadie se entere, o defecto medido con norma |
| **Media** | Deuda que encarece cada cambio futuro |
| **Baja** | Correcto pero mejorable; sin consecuencia observable |

---

## 1. Bloqueantes

- [ ] **La selección de dependiente se pierde al navegar.**
  Un representante elige a un dependiente en Mi cuenta, entra a Pagos, y la
  pantalla muestra los datos de otro. Plan, monto e historial equivocados.
  Es el único defecto abierto con consecuencia de dinero.
  *Fuente:* evaluación de usabilidad, «Lo que bloquea la meta» §1.

---

## 2. Backend

Los tres primeros están cerrados. Se conservan con casilla propia porque un
patrón de concurrencia sin registro visible es un patrón que se vuelve a
perseguir: los tres eran consultar-y-luego-escribir sin bloqueo, los tres se
cerraron con bloqueos de fila en #19, y los tests no los veían porque corren en
serie.

- [x] **Aprobación de pago: consultar-y-luego-escribir sin bloqueo.** (#19)
  La fila del pago se lee con `SELECT ... FOR UPDATE`: dos validaciones
  concurrentes del mismo pago se serializan, una gana y la otra recibe
  `OperacionInvalida`. Sin esto, revalidar reactivaba la membresía, re-aplicaba
  la gratuidad familiar y duplicaba la notificación.
  *Ubicación:* `backend/app/servicios_negocio/membresia_pago_servicio.py:495-501`.

- [x] **Capacidad de nivel: consultar-y-luego-escribir sin bloqueo.** (#19)
  `obtener_por_id_bloqueado` toma la fila del nivel con `FOR UPDATE`, así el
  conteo de la segunda asignación ya incluye a la primera. Antes, dos
  asignaciones al último cupo pasaban las dos.
  *Ubicación:* `backend/app/servicios_negocio/ranking_servicio.py:85-104`.

- [x] **Guarda de último administrador: consultar-y-luego-escribir sin bloqueo.** (#19)
  La fila del catálogo `ADMINISTRADOR` actúa como mutex vía
  `repo_rol.bloquear_por_tipo`. Antes, quitar el rol a uno y desactivar al otro
  en paralelo dejaba al club sin ningún administrador y sin vía de rescate.
  *Ubicación:* `backend/app/servicios_negocio/rol_servicio.py:65-84`.

- [ ] **El handler global mapea `IntegrityError` a 409.** (Media)
  Un futuro error de servidor por violación de integridad se le presenta al
  cliente como un conflicto que él causó. El traceback sí queda registrado.
  *Ubicación:* `backend/main.py`.
  *Fuente:* auditoría, hallazgo abierto D.

- [ ] **Cuatro endpoints de listado devuelven `List[...]` sin paginar.** (Media)
  `GET /ranking/niveles`, `GET /ranking/notificaciones/mias`,
  `GET /membresias/tipos` y `GET /personas/{id}/representados`.
  Son de cardinalidad acotada por el negocio, por eso quedaron al final.
  *Fuente:* hallazgos de la presentación §1.

- [ ] **`institucion_repositorio` sin paginación ni conteo.** (Baja)
  Es el último de los ocho repositorios que no acepta `skip`/`limit`.
  *Ubicación:* `backend/app/infraestructura/repositorios/institucion_repositorio.py`.

---

## 3. Base de datos

- [ ] **Columna heredada `ranking.ultimo_combate_o_asistencia`.** (Baja)
  Sin zona horaria, ausente de `modelos.py`, excluida a propósito en
  `test_drift_migraciones.py`. Diferida en el docstring de la migración
  `644d352bf590`.

---

## 4. Frontend y BFF

- [ ] **El botón Atrás del navegador destruye la lista de asistencia en curso.** (Alta)
  Sin aviso y sin borrador. Los tres pasos del wizard no son entradas de
  historial.
  *Fuente:* evaluación de usabilidad, «Lo que bloquea la meta» §2.

- [ ] **Los indicadores de foco incumplen WCAG 2.4.11.** (Alta)
  `outline-ball` mide 1,42:1 sobre blanco contra los 3:1 requeridos. Corregido
  solo en el asistente; el resto del sistema mantiene el defecto.
  Es un cambio de token: se corrige en un lugar y sube en las 26 páginas.

- [ ] **Cuatro fallos de contraste medidos.** (Alta)
  El peor es 2,31:1 en el panel de datos de prueba de `/student/enroll`; 3,78:1
  en la nota de seguridad del login.

- [ ] **Objetivos táctiles bajo el mínimo.** (Media)
  El token `h-ctl` es de 40 px contra los 44 recomendados, de forma sistemática
  en todo el shell. También es un cambio de token.

- [ ] **`AppShell` no tiene enlace de salto al contenido.** (Media)
  El landing sí lo tiene.

- [ ] **Logos con `alt` vacío** en landing, enroll y carnet. (Media)

- [ ] **No existe deshacer en ninguna parte.** (Media)
  «Corregir» en el historial es un viaje aparte, no un undo.
  *Fuente:* evaluación de usabilidad, principio 3 (6/10).

- [ ] **El checklist de aprobación no se adapta al método de pago.** (Media)
  En un pago en efectivo exige afirmar que el comprobante es legible y que su
  monto coincide, sobre un comprobante que no existe. Una salvaguarda que hay
  que falsear enseña a tildar sin mirar.

- [ ] **Sin acciones por lote en la cola de pagos.** (Media)
  Trece pagos idénticos son trece decisiones con checklist.
  *Fuente:* evaluación de usabilidad, principio 7 (7/10).

- [ ] **Rutas BFF duplicadas en dos idiomas.** (Media)
  Coexisten `attendance`/`asistencias`, `payments`/`membresias` y
  `members`/`personas`. Refactorización amplia, sin efecto visible para el
  usuario, pero es una de las costuras que produjo defectos reales.

- [ ] **Regresión de vocabulario.** (Media)
  Vocabulario de base de datos filtrado a la UI y placeholders de seed
  visibles. Es el único principio de la evaluación que **bajó** entre cortes
  (9 → 8).

- [ ] **Faltan estados de carga, guardado y confirmación.** (Media)
  Ninguna acción confirma visiblemente que ocurrió.
  *Fuente:* evaluación de usabilidad, principio 1 (7/10).

- [ ] **La interfaz de fichas médicas sigue restringida a administradores.** (Media)
  La API ya autoriza a un representante a leer y actualizar la ficha de su
  representado, con tests de aislamiento entre familias. La UI no acompañó:
  `MedicalRecordEditor` existe solo bajo `members/`, que es área de
  administración.

- [ ] **Bloque `purple` en `admin/crear-cuenta`.** (Baja)
  Fuera del sistema de tokens de diseño. Decisión visual.

---

## 5. Servicios externos y operación

- [ ] **El circuit breaker se abre en silencio.** (Alta)
  Cloudinary y SMTP degradan correctamente mediante `circuito_breaker.py` y
  `resiliencia.py`, pero nada observa ni alerta cuando el circuito abre. Un
  servicio caído que nadie ve es un servicio caído que nadie arregla.

- [ ] **El healthcheck del backend no comprueba PostgreSQL ni Redis.** (Alta)
  `GET /health` devuelve `{"estado": "ok"}` incondicionalmente
  (`backend/main.py:158`). Reporta sano con la base caída.

- [ ] **Sin correlación de requests, métricas ni trazas.** (Media)
  No hay `X-Request-ID` ni equivalente en el backend. Un incidente de extremo a
  extremo no se puede reconstruir.
  *Fuente:* auditoría, deuda operativa.

- [ ] **`docker-compose.prod.yml` no completa el contrato de operación.** (Media)
  Sin ingress/TLS, sin límites de recursos y sin rotación de logs.

- [ ] **Los reintentos de alertas pueden duplicar notificaciones.** (Media)
  In-app o por correo.
  *Fuente:* auditoría, deuda operativa.

- [ ] **`.env.example` incompletos.** (Media)
  Faltan `RESET_HOSTS_PERMITIDOS`, `TEST_DATABASE_URL`, `IMAGE_TAG`,
  `FRONTEND_URL` y seis `SMTP_*`.
  **Bloqueado:** los permisos del repositorio impiden editar `.env*`.

- [ ] **Al eliminar un campo del contrato, una pestaña abierta con el bundle
  anterior muestra datos incorrectos sin error visible.** (Baja)
  Inherente al despliegue del frontend; se resuelve al recargar.
  *Fuente:* auditoría, hallazgo abierto E.

- [ ] **Dos sesiones de pytest concurrentes contra un mismo Postgres colisionan.** (Baja)
  Fixture de esquema compartido. No afecta a CI, que usa un proceso y una base
  por job.
  *Ubicación:* `backend/tests/conftest.py`.
  *Fuente:* auditoría, hallazgo abierto C.

---

## 6. Decisiones de negocio pendientes

Ninguna de estas se resuelve escribiendo código. Requieren definición.

- [ ] **Borrado de `Persona`: ¿lógico o duro con `RESTRICT`?**
  `Persona.activo` existe (`modelos.py:149`) y la baja lógica funciona, pero la
  decisión nunca se tomó de forma explícita: simplemente no hizo falta.

- [ ] **Vincular una cuenta de menor ya creada a su representante.**
  `POST /personas/{id}/representados` solo da de alta un representado nuevo. Una
  menor que se autogestionó la cuenta no tiene vía de vinculación posterior.

- [ ] **Qué operaciones administrativas existen realmente en el negocio.**
  El caso testigo es «Crear horario»: los horarios son cinco, fijos y derivados
  por categoría, así que el botón no crea un horario — asigna un entrenador a
  una categoría que ya existe. Candidatos a revisar con el mismo criterio: alta
  y baja de niveles de ranking, alta de tipos de membresía, alta de
  instituciones, y la sección Ranking completa.
  *Fuente:* hallazgos de la presentación §2 y §4.

---

## 7. Cerrado desde la auditoría del 27 de julio

Se conserva para no volver a perseguirlo.

| # | Hallazgo | Cómo se cerró |
|---|---|---|
| 1 | Un pago podía asociarse a una membresía ajena | Chequeo explícito de pertenencia; 403 y no 404, igual que el resto de recursos ajenos |
| 2 | Restablecer la contraseña no revocaba las sesiones | Revocación unificada vía `version_sesion` |
| 3 | Suspender una cuenta no revocaba sus tokens | Ídem, más rechazo explícito de usuario inactivo |
| 4 | Quitar un rol no retiraba los privilegios | Ídem |
| 5 | Aprobación de pago y comprobante no atómicos | Tarea `reconciliar_comprobantes_faltantes` cada 15 minutos, umbral de 10 |
| 6 | Recuperación informaba éxito aunque se perdiera | Ahora registra el fallo y responde `ServicioNoDisponible` |
| 7 | Invariantes financieras vulnerables a concurrencia | Índices únicos parciales `uq_membresia_activa_por_persona` y `uq_pago_pendiente_por_membresia` (migración `c3d9f2b7a1e5`), con tests que verifican que chequeo y constraint responden igual |
| 8 | Desactivar una persona no revocaba sus tokens | Cubierto por la revocación unificada |
| A | `capacidad_maxima` verificada sin bloqueo | `SELECT ... FOR UPDATE` sobre la fila del nivel (issue #8), con test de dos asignaciones concurrentes por un único cupo |
| B | Guarda de «último administrador» sin bloqueo | `SELECT ... FOR UPDATE` sobre la fila del catálogo `ADMINISTRADOR` (issue #8), con test de quitar rol y desactivar cuenta en simultáneo |
| — | CI no construía ni levantaba la imagen Docker | Job `docker-images`: construye, levanta, sondea hasta sano y baja |
| — | `frontend`, `celery-worker`, `celery-beat` sin healthcheck | Los siete servicios los declaran |
| — | CI en pnpm 9 contra `package.json` en 10.33.2 | CI deriva la versión de `package.json`, fuente única |
| — | `.split()` en `enrollment-adapter.ts` devolvía 500 | `(fichaMedica.condicionesSalud ?? "")` antes del `.split()` |
| — | Faltaba `uq_alumno_horario` | Declarada en `AlumnoHorario.__table_args__`, con test propio |
| — | `Ranking.participo` y tres columnas más, código muerto | Eliminadas, con el comentario que documenta por qué |
| — | Los tres listados que crecen con el padrón, sin paginar | `PaginatedResponse` con `skip`, `limit` y conteo |

La revocación de sesiones tiene siete archivos de test dedicados
(`test_revocacion_unificada_sesiones.py` y compañía). Los cuatro hallazgos de
autorización se cerraron con un solo mecanismo, no con cuatro parches.

Las tres carreras se cerraron con las dos herramientas correctas y no con una
sola: **constraint** donde la invariante es una propiedad de los datos —una
membresía activa por persona, un pago pendiente por membresía— y **bloqueo de
fila** donde es un conteo que hay que serializar —el cupo del nivel, el último
administrador—. `test_invariantes_constraints.py` las prueba con barreras de
hilos, no razonando sobre el código.

---

## Resumen

**Un bloqueante**: la selección de dependiente que se pierde al navegar. Mueve
plata equivocada, así que va primero.

**Tres ítems de token en el frontend** —foco, contraste y objetivo táctil— que
se corrigen en un lugar y suben en las 26 páginas. Es la mejor relación
esfuerzo/resultado abierta en el proyecto.

**Dos agujeros de operación**: el healthcheck que miente y el circuit breaker
que degrada en silencio. Ninguno se manifiesta hasta el día que importa.
