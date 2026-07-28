# Hallazgos posteriores a la presentación — Cata Club

- **Fecha:** 27 de julio de 2026
- **Origen:** observaciones de la docente durante la presentación, ampliadas con verificación directa contra el sistema en ejecución (`main` en `2722839`).
- **Propósito:** dejar cada hallazgo con su evidencia y su causa, para decidir qué se corrige y en qué orden. **Este documento no corrige nada.**

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

| Endpoint | Pagina |
|---|---|
| `GET /personas/` | Sí (`skip`/`limit`, **sin tope superior**) |
| `GET /personas/buscar` | Sí (tope `le=50`) |
| `GET /membresias/` | Sí (tope `le=200`) |
| `GET /membresias/pagos` | Sí (tope `le=200`) |
| `GET /ranking/alumnos-con-nivel` | **No** |
| `GET /ranking/asignaciones` | **No** |
| `GET /ranking/niveles` | **No** |
| `GET /personas/entrenadores` | **No** |
| `GET /asistencias/horarios/{id}/alumnos` | **No** |
| `GET /personas/{id}/representados` | **No** |
| `GET /ranking/notificaciones/mias` | **No** |
| `GET /membresias/tipos` | **No** |

La observación de la presentación apuntaba a **Nivel**, y es correcta: `listar_alumnos_con_nivel` (`ranking_router.py:60`) no recibe `skip` ni `limit`. Con mil alumnos devuelve mil, y `NivelLadderScreen` los renderiza todos.

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

| # | Tema | Estado |
|---|---|---|
| 1 | Borrado de `Persona`: ¿lógico o duro con `RESTRICT`? | Se asumió lógico para diagnosticar; **no se implementó** |
| 2 | `Ranking.participo` — código muerto | Se decidió eliminarlo; acoplado a la decisión 1 |
| 3 | Menor autogestionada cuyo representante le crea la cuenta | Sin vía de vinculación; un representante nunca puede leer la ficha médica de su representado |

---

## 6. Deuda conocida, con prioridad sugerida

| Prioridad | Tema | Nota |
|---|---|---|
| **Alta** | CI no construye ni levanta la imagen Docker | Es el hueco por el que pasó el defecto del contenedor. En producción se manifiesta como un contenedor reiniciando sin que nadie se entere |
| Alta | `frontend`, `celery-worker`, `celery-beat` sin `healthcheck:` | Reportan `Up`, nunca `healthy` |
| Media | `.env.example` incompletos | Faltan `RESET_HOSTS_PERMITIDOS`, `TEST_DATABASE_URL`, `IMAGE_TAG`, `FRONTEND_URL` y seis `SMTP_*`. **Bloqueado: los permisos del repositorio impiden editar `.env*`** |
| Media | Rutas BFF duplicadas en dos idiomas | Refactorización amplia, sin efecto visible |
| Baja | `.split()` en `enrollment-adapter.ts` | El validador acepta `condicionesSalud` como opcional, el constructor lo exige → 500 en lugar de 400. **Verificado que el asistente siempre envía el campo**, así que un usuario real no puede alcanzarlo |
| Baja | Validador de `jwt_secret_key` incondicional | Única falla de arranque real. No se tocó: restringirlo a producción sería *relajar* la seguridad |
| Baja | Bloque `purple` en `admin/crear-cuenta` | Fuera del sistema de tokens de diseño. Decisión visual |
| Baja | Falta `uq_alumno_horario`; sobra `ranking.ultimo_combate_o_asistencia` | Ya diferidas en el docstring de la migración `644d352bf590` |

---

## 7. Lo que se revisó y **no** es problema

Para no gastar tiempo en falsos positivos:

- **Datos de demostración.** Ya están condicionados por `NODE_ENV` (`enroll-utils.ts:190`).
- **El botón «volver» del asistente de inscripción.** Es intencional y condicional: `/student` si hay sesión, `/` si no. Correcto como está.
- **`ranking.ultimo_combate_o_asistencia` sin zona horaria.** Es la columna heredada, ausente de `modelos.py` y ya excluida a propósito en `test_drift_migraciones.py`.
- **Aviso de listado incompleto en Miembros.** Existe y es explícito (ver §1).
- **Crear entrenador.** Verificado de extremo a extremo: responde 201, el token incluye el rol, y la cuenta nueva navega las pantallas de entrenador.

---

## Resumen

Lo que se debe corregir sin discusión: la **paginación de los listados que crecen con el padrón** (§1).

Lo que se debe decidir antes de tocar código: **qué operaciones administrativas existen realmente en el negocio** (§2 y §4).

Lo que determina si esto vuelve a pasar: **la duplicación de contratos** (§3). Es lo menos visible y lo más importante.
