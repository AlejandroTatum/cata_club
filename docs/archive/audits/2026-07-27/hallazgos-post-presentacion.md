# Hallazgos posteriores a la presentación — Cata Club

- **Fecha:** 27 de julio de 2026
- **Origen:** observaciones de la docente durante la presentación, ampliadas con verificación directa contra el sistema en ejecución (`main` en `2722839`).
- **Propósito:** dejar cada hallazgo con su evidencia y su causa, para decidir qué se corrige y en qué orden. **Este documento no corrige nada.**
- **Último seguimiento:** 5 de agosto de 2026, verificado contra `main` en `717787a`. Ver §8.

> **Sobre el seguimiento.** El diagnóstico original se conserva tal como se
> escribió: es el registro de lo que se sabía el 27 de julio. Lo que cambió se
> anota en una columna «Hoy» dentro de cada tabla y se resume en §8. Un
> documento de hallazgos que no dice qué se cerró hace perder tiempo
> persiguiendo defectos que ya no existen.

## Cómo leer este documento

Cada hallazgo indica su **estado de verificación**:

| Marca | Significado |
|---|---|
| **Reproducido** | Se ejecutó y se observó la falla. Hay evidencia textual. |
| **Verificado en código** | Se leyó el código y la conclusión se sigue de él, sin ejecutarlo. |
| **Criterio** | Juicio de producto o diseño. Discutible por definición. |

La distinción importa: lo reproducido no se discute, se arregla. Lo marcado como criterio es donde hace falta la decisión de un humano.

---

## 1. El sistema no está pensado para crecer

**Estado: Verificado en código.** Severidad: alta para producción, nula para la demo.

### Endpoints de listado sin paginación

De los listados que alimentan pantallas, **la mayoría devuelve la tabla entera**:

| Endpoint | Paginaba (27-jul) | Hoy (5-ago) |
|---|---|---|
| `GET /personas/` | Sí (`skip`/`limit`, **sin tope superior**) | Sí, con tope `le=200` |
| `GET /personas/buscar` | Sí (tope `le=50`) | Sin cambios |
| `GET /membresias/` | Sí (tope `le=200`) | Sin cambios |
| `GET /membresias/pagos` | Sí (tope `le=200`) | Sin cambios |
| `GET /ranking/alumnos-con-nivel` | **No** | `PaginatedResponse`, tope `le=200` |
| `GET /ranking/asignaciones` | **No** | `PaginatedResponse`, tope `le=200` |
| `GET /asistencias/horarios/{id}/alumnos` | **No** | `PaginatedResponse`, tope `le=200` |
| `GET /personas/entrenadores` | **No** | Ruta eliminada (issue #13); queda guardia estructural en `test_personas.py` |
| `GET /ranking/niveles` | **No** | Sigue devolviendo `List[...]` |
| `GET /personas/{id}/representados` | **No** | Sigue devolviendo `List[...]` |
| `GET /ranking/notificaciones/mias` | **No** | Sigue devolviendo `List[...]` |
| `GET /membresias/tipos` | **No** | Sigue devolviendo `List[...]` |

La observación de la presentación apuntaba a **Nivel**, y es correcta: `listar_alumnos_con_nivel` (`ranking_router.py:60`) no recibe `skip` ni `limit`. Con mil alumnos devuelve mil, y `NivelLadderScreen` los renderiza todos.

> **Hoy:** los tres listados que crecen con el padrón —`alumnos-con-nivel`,
> `asignaciones` y `alumnos por horario`— ya devuelven `PaginatedResponse` con
> `skip`, `limit` y conteo total. Los cuatro que siguen sin paginar son los de
> cardinalidad acotada por el negocio, que este mismo documento identificó como
> los que no lo necesitan.

Algunos de esos listados son legítimamente cortos y acotados por el negocio — `niveles` son 11, `tipos` de membresía son 2, `entrenadores` son pocos. No todos necesitan paginarse. Los que sí crecen con el padrón son **`alumnos-con-nivel`**, **`asignaciones`** y **`alumnos por horario`**.

### Corrección a una afirmación previa

Durante el análisis se afirmó que la pantalla de Miembros «miente en silencio» al mostrar solo 200 registros. **Es falso.** `frontend/src/app/members/page.tsx:1386` y `:1401` avisan de forma explícita:

> *«Este listado puede incluir hasta 200 registros y no confirma que se hayan cargado todos los miembros.»*

La limitación existe —el tope `le=200` está cableado en el backend, así que pedir más es imposible— pero **está declarada**, no oculta. El aviso es un parche honesto, no una paginación real.

---

## 2. Botones que no corresponden al negocio

**Estado: Criterio**, con un hecho verificado debajo.

### El caso «Crear horario»

El hecho: los horarios del club son **cinco, fijos, definidos por categoría** y cableados en `backend/app/dominio/categoria_metadata.py`. El backend **no acepta** que se le envíe una hora; la deriva.

| Categoría | Días | Horario |
|---|---|---|
| Formativo (5–10 años) | Lun–Vie | 15:00–16:00 |
| Infantil (8–12) | Lun–Vie | 16:00–17:00 |
| Juvenil (>12) | Lun–Vie | 17:00–18:00 |
| Competitivo (Selección) | Lun–Sáb | 18:00–20:00 |
| Adultos (>18) | Lun–Vie | 20:00–21:15 |

Entonces el botón **no crea un horario**. Lo que hace es *asignar un entrenador y unos días a una categoría que ya existe*. El nombre describe una operación que el sistema no permite, y por eso se percibe como un botón sin sentido: se le pide al usuario que «cree» algo que el negocio ya fijó.

**No es que sobre la función** — asignar entrenador a una categoría es necesario. Es que el nombre y el encuadre son incorrectos.

### Qué revisar con el mismo criterio

Antes de decidir qué se quita, conviene recorrer cada acción de administrador con una sola pregunta: *¿esta operación existe en el negocio, o existe solo porque la tabla tiene un CRUD?* Candidatos a revisar: alta/baja de niveles de ranking, alta de tipos de membresía, alta de instituciones, y la sección Ranking completa (ya se decidió que deja de ser clasificación competitiva).

---

## 3. Mantenibilidad — la causa de fondo

**Estado: Verificado en código.** Es el hallazgo más importante del documento.

Los seis defectos encontrados esta semana no son independientes. **Cinco salen de la misma causa: contratos duplicados que se separan sin que nada lo note.**

| # | Defecto | Costura que se rompió |
|---|---|---|
| 1 | 404 al quitar rol (#172) | Cliente usaba segmento de ruta; BFF esperaba query string |
| 2 | Crear/editar horario (`fix/horarios-contrato-bff`) | BFF quedó con el contrato viejo entre cliente y backend |
| 3 | Inscripción rota (#171) | Enum en Python sin migración; base de tests con el mismo defecto |
| 4 | Contenedor no arrancaba (#170) | CI nunca construye ni levanta la imagen |
| 5 | E2E rojo los lunes (#168) | Fixture con día fijo contra UI que resuelve «hoy» |

### Las duplicaciones concretas

1. **Cliente → BFF → Backend.** El mismo contrato se escribe tres veces a mano. No hay tipos compartidos ni generación desde el esquema. Cada cambio exige recordar tres archivos.
2. **Rutas BFF duplicadas en dos idiomas**, para el mismo dominio:
   - `api/attendance/*` **y** `api/asistencias/*`
   - `api/payments/*` **y** `api/membresias/*`
   - `api/members` **y** `api/personas/*`
3. **Listas cerradas repetidas en cuatro capas.** `tipo_cuenta` está escrito en el esquema del backend, en la lista blanca del BFF, en el tipo del cliente y en las tarjetas de la UI.
4. **Nada en CI construye la imagen Docker.** El job de frontend corre `pnpm build` y Playwright contra la salida standalone. La imagen que se publica a GHCR no se prueba nunca.
   **Cerrado.** El job `docker-images` de `.github/workflows/ci.yml` construye la
   imagen, levanta el stack con `docker-compose.prod.yml`, sondea `docker compose ps`
   hasta que todos los servicios queden sanos —sin `sleep`— y lo baja con `down -v`.

### El patrón de los tests

Los tests existen y pasan. El problema es **qué miden**: cada uno prueba un lado de la costura, ninguno la costura. Un test que llama al handler del BFF pasándole el cuerpo correcto no puede detectar que el cliente arma otro cuerpo.

Mientras el contrato se escriba tres veces a mano, **este tipo de defecto va a volver**. Ninguna cantidad de tests unitarios lo evita; hay que eliminar la duplicación o cubrir la costura explícitamente.

---

## 4. Simplificar — cómo interpreto la indicación

**Estado: Criterio.** Esta sección es interpretación y necesita validación.

La indicación fue hacer el sistema *más simple*. Entiendo que no se pide quitar funciones, sino reducir **el modelo mental** que el usuario debe sostener para operarlo.

El sistema creció por acumulación: cada hueco funcional detectado agregó un control. Nunca se preguntó si ese control debía existir. El resultado es una superficie amplia donde el usuario debe deducir qué operaciones son reales.

Tres preguntas que propongo aplicar a cada pantalla, para discutir:

1. **¿Esta operación existe en el negocio?** «Crear horario» no existe: los horarios son fijos.
2. **¿El nombre dice lo que hace?** Si el botón dice «crear» y en realidad asigna, el usuario construye un modelo mental equivocado.
3. **¿Quién la ejecuta y con qué frecuencia?** Una operación anual no merece el mismo lugar que una diaria.

---

## 5. Pendientes que requieren decisión

Ninguno de estos se puede resolver sin definición del negocio.

| # | Tema | Estado (27-jul) | Hoy (5-ago) |
|---|---|---|---|
| 1 | Borrado de `Persona`: ¿lógico o duro con `RESTRICT`? | Se asumió lógico para diagnosticar; **no se implementó** | **Sigue abierto.** `Persona.activo` existe (`modelos.py:149`), pero no hay endpoint de borrado de persona: la decisión nunca se tomó, solo no hizo falta |
| 2 | `Ranking.participo` — código muerto | Se decidió eliminarlo; acoplado a la decisión 1 | **Cerrado.** La columna se eliminó junto con `puntaje_acumulado`, `posicion_actual` y `esta_en_ranking`; queda el comentario que documenta por qué (`modelos.py:620`) |
| 3 | Menor autogestionada cuyo representante le crea la cuenta | Sin vía de vinculación; un representante nunca puede leer la ficha médica de su representado | **Cerrado a medias.** El representante **sí** lee y actualiza la ficha médica de su representado, con tests de aislamiento entre familias (`test_ficha_medica_representante.py`). Lo que sigue sin existir es vincular una cuenta de menor **ya creada**: `POST /personas/{id}/representados` solo da de alta un representado nuevo |

---

## 6. Deuda conocida, con prioridad sugerida

| Prioridad | Tema | Nota | Hoy (5-ago) |
|---|---|---|---|
| **Alta** | CI no construye ni levanta la imagen Docker | Es el hueco por el que pasó el defecto del contenedor. En producción se manifiesta como un contenedor reiniciando sin que nadie se entere | **Cerrado.** Job `docker-images`: construye, levanta el stack de producción, sondea hasta `healthy` y lo baja |
| Alta | `frontend`, `celery-worker`, `celery-beat` sin `healthcheck:` | Reportan `Up`, nunca `healthy` | **Cerrado.** Los siete servicios de `docker-compose.yml` declaran `healthcheck:` |
| Media | `.env.example` incompletos | Faltan `RESET_HOSTS_PERMITIDOS`, `TEST_DATABASE_URL`, `IMAGE_TAG`, `FRONTEND_URL` y seis `SMTP_*`. **Bloqueado: los permisos del repositorio impiden editar `.env*`** | Sigue bloqueado por la misma causa |
| Media | Rutas BFF duplicadas en dos idiomas | Refactorización amplia, sin efecto visible | **Sigue abierto.** Coexisten `attendance`/`asistencias`, `payments`/`membresias` y `members`/`personas` |
| Baja | `.split()` en `enrollment-adapter.ts` | El validador acepta `condicionesSalud` como opcional, el constructor lo exige → 500 en lugar de 400. **Verificado que el asistente siempre envía el campo**, así que un usuario real no puede alcanzarlo | **Cerrado.** El adaptador usa `(fichaMedica.condicionesSalud ?? "")` antes del `.split()` |
| Baja | Validador de `jwt_secret_key` incondicional | Única falla de arranque real. No se tocó: restringirlo a producción sería *relajar* la seguridad | Sin cambios, por decisión |
| Baja | Bloque `purple` en `admin/crear-cuenta` | Fuera del sistema de tokens de diseño. Decisión visual | **Sigue abierto.** La pantalla conserva las clases `purple` |
| Baja | Falta `uq_alumno_horario`; sobra `ranking.ultimo_combate_o_asistencia` | Ya diferidas en el docstring de la migración `644d352bf590` | **Cerrado a medias.** `uq_alumno_horario` ya está en `AlumnoHorario.__table_args__` con test propio (`test_restricciones_unicidad.py`); la columna heredada sigue ahí, excluida a propósito |

---

## 7. Lo que se revisó y **no** es problema

Para no gastar tiempo en falsos positivos:

- **Datos de demostración.** Ya están condicionados por `NODE_ENV` (`enroll-utils.ts:190`).
- **El botón «volver» del asistente de inscripción.** Es intencional y condicional: `/student` si hay sesión, `/` si no. Correcto como está.
- **`ranking.ultimo_combate_o_asistencia` sin zona horaria.** Es la columna heredada, ausente de `modelos.py` y ya excluida a propósito en `test_drift_migraciones.py`.
- **Aviso de listado incompleto en Miembros.** Existe y es explícito (ver §1).
- **Crear entrenador.** Verificado de extremo a extremo: responde 201, el token incluye el rol, y la cuenta nueva navega las pantallas de entrenador.

---

## 8. Estado general — 5 de agosto de 2026

Inventario verificado contra `main` en `717787a`. Sirve para ubicar cualquier hallazgo de este documento dentro del sistema completo.

| Capa | Qué hay | Estado |
|---|---|---|
| Base de datos | 23 tablas, 25 migraciones Alembic | CI corre `migraciones-desde-cero` |
| Backend — dominio | 6 módulos de entidades | Sin pendientes |
| Backend — servicios | 15 servicios de negocio, más `gestor_permisos` y `politica_acceso` | Sin pendientes |
| Backend — repositorios | 8 repositorios; 7 aceptan `skip`/`limit` y devuelven conteo | Falta `institucion_repositorio` |
| Backend — API | 11 routers | 4 endpoints sin paginar (§1) |
| Backend — tests | 84 archivos, 717 funciones de test | Incluye contratos anti-N+1 |
| BFF (rutas de Next) | 55 rutas | Duplicación en dos idiomas (§6) |
| Frontend — páginas | 26 páginas: administrador, entrenador, alumno, autenticación y landing | Los tres roles cubiertos |
| Frontend — tests | 162 archivos, 2451 casos | Sin pendientes |
| E2E | 11 specs de Playwright | Resuelto el fallo de los lunes (#168) |
| CI | 1 workflow, 5 jobs: backend, migraciones, frontend, imágenes y levantado del stack | Construye y levanta la imagen |
| Healthchecks | Los siete servicios de `docker-compose.yml` | Sin pendientes |

### Lo que queda abierto

1. `institucion_repositorio` sin paginar — es el último de la capa de repositorios.
2. Cuatro endpoints devuelven `List[...]`: `/ranking/niveles`, `/ranking/notificaciones/mias`, `/membresias/tipos` y `/personas/{id}/representados` (§1).
3. Rutas BFF duplicadas en dos idiomas (§6).
4. `.env.example` incompletos, bloqueados por permisos del repositorio (§6).
5. Bloque `purple` en `admin/crear-cuenta`, fuera del sistema de tokens (§6).
6. Dos decisiones de negocio: el borrado de `Persona` y la vinculación de una cuenta de menor ya creada (§5).
7. La revisión de §2 y §4 —qué operaciones administrativas existen en el negocio— sigue sin hacerse.

---

## 9. Calificación por área — 5 de agosto de 2026

Evaluación sobre 10, con la evidencia que sostiene cada nota. Los pendientes que
la bajan están detallados en `docs/pendientes.md`.

| Área | Nota | Qué la sostiene | Qué la baja |
|---|---:|---|---|
| Servicios externos | 8/10 | Circuit breaker propio (`circuito_breaker.py`, `resiliencia.py`) sobre Cloudinary y SMTP; Celery y Redis con healthcheck; reintento del lote alineado | El circuito abre sin que nada lo observe; `.env.example` incompletos |
| Base de datos | 9/10 | 23 tablas, 25 migraciones, 23 índices; `migraciones-desde-cero` en CI; test de drift; índices únicos parciales que respaldan las invariantes financieras | Columna heredada sin zona horaria |
| Backend | 8/10 | 717 tests con `fail_under = 90`; revocación de sesiones unificada con siete archivos de test; carreras cerradas con `FOR UPDATE` y probadas con barreras de hilos; contratos anti-N+1 | Cuatro endpoints sin paginar; `institucion_repositorio` sin conteo; `IntegrityError` mapeado a 409 |
| Frontend | 6/10 | 2451 casos en 162 archivos, 11 specs E2E, sistema de tokens de diseño, un solo shell para los tres roles | La selección de dependiente se pierde al navegar; foco y contraste incumplen WCAG; objetivo táctil bajo el mínimo |

**Promedio: 7,8/10.**

El frontend es el que arrastra, y no por gusto: son defectos medidos. Tres de
ellos —foco, contraste y objetivo táctil— son cambios de token que suben en las
26 páginas a la vez.

Backend y base de datos sostienen la nota por la misma razón: las invariantes
que importan están garantizadas donde corresponde. Constraint donde la
invariante es una propiedad de los datos, bloqueo de fila donde es un conteo que
hay que serializar. Lo que queda ahí es acabado, no riesgo.

---

## Resumen

Lo que se debía corregir sin discusión —la **paginación de los listados que crecen con el padrón** (§1)— está hecho. Los tres listados que escalan con el padrón devuelven `PaginatedResponse` con conteo.

Lo que se debe decidir antes de tocar código: **qué operaciones administrativas existen realmente en el negocio** (§2 y §4). Sigue pendiente, y es la parte que ninguna cantidad de código resuelve sola.

Lo que determina si esto vuelve a pasar: **la duplicación de contratos** (§3). El agujero de CI que dejaba pasar la imagen sin probar está cerrado, pero el contrato cliente → BFF → backend se sigue escribiendo tres veces a mano. Es lo menos visible y lo más importante.
