# Verificación en QA — 10 de agosto de 2026

- **Entorno:** `make qa-up` (proyecto `cataclub-qa`), frontend en `:3000`,
  backend en `:8000`.
- **Base:** `main` en `e663953`, más la rama `fix/seed-inscripcion-atomica`.
- **Datos:** `make qa-reset` + seed corregido — 59 alumnos, 307 inscripciones,
  500 asistencias, 16 representantes.
- **Método:** recorrido con Chromium real, tres roles (admin, entrenador,
  representante con 4 hijos), capturas en cada pantalla y consultas directas a
  la API y a Postgres para separar defecto de dato.

**Este documento no propone fixes todavía.** Es el insumo para que los
verifiques vos. Cada fila lleva la evidencia con la que se afirmó, y la
columna que falta es la tuya.

---

## Primero: el seed mentía, y eso cambió dos diagnósticos

El seed inscribía a los alumnos en «los primeros 3 horarios del club» por id —
el modelo por día, anterior al issue #181. La regla vigente es **atómica por
categoría**: o estás en todos los días de tu categoría, o en ninguno.

La base de QA tenía, por eso, un estado que la propia API ya no puede
producir: 28 alumnos en Formativo lunes/martes/miércoles y solo 4 en
jueves/viernes.

| | antes | después |
|---|---|---|
| Alumnos violando la regla atómica | 24 | **0** |
| Competitivo | 0 inscriptos | **12** |
| Inscripciones | 75 | **307** |
| Asistencias | 288 | **500** |

Arreglado en `backend/scripts/seed_dev_bulk.py` (rama
`fix/seed-inscripcion-atomica`), y **todo lo que sigue se verificó después de
resembrar**. Sin ese paso, dos hallazgos se habrían reportado mal.

---

## 🔴 Nuevos — no estaban en tu lista del 7 de agosto

- [ ] **N1 · El entrenador ve «Persona 15» en vez del nombre de la alumna.**
  - **Dónde se ve:** panel del entrenador (`/trainer`), en la alerta de
    ausencias: «**Persona 15** suma 5 ausencias este mes».
  - **Causa raíz, verificada contra la API en vivo:**
    ```
    entrenador → GET /api/v1/personas/?limit=200  → 403 Permisos insuficientes
    entrenador → GET /api/v1/personas/15          → 200 OK  (Emily Moreira Pilay)
    ```
    `fetchPersonaNameMap` (`frontend/src/lib/server/attendance-adapter.ts:118-123`)
    hace `if (!result.ok || !result.response.ok) return new Map()` — se traga
    el 403 y devuelve un mapa vacío. `buildAttendanceRecord` (`:152`) cae
    entonces al fallback `Persona ${personaId}`.
  - **Alcance real, acotado hoy:** afecta a la ruta
    `frontend/src/app/api/attendance/records/route.ts`, único consumidor de
    ese par en producción. **El roster de pasar lista NO está afectado** —
    ahí los nombres se leen por otra vía y aparecen bien (verificado: Erick
    Bravo Solorzano, Dayana Cedeño Loor…). El historial tampoco reprodujo.
  - **Por qué importa igual:** el comentario del código presenta el fallback
    como degradación elegante ante un fallo raro. Para el rol ENTRENADOR no es
    raro: es el **100 % de los casos**, siempre, en toda superficie que use esa
    ruta.
  - **⚠️ Para vos:** decidime si el entrenador *debería* poder listar personas
    (y entonces el fix es el permiso) o no (y entonces el fix es que el BFF
    resuelva el nombre por otra vía y **no** degrade en silencio).

- [ ] **N2 · El seed escribía datos que la API ya no acepta.** Descrito arriba.
  Ya arreglado, pendiente de tu revisión y de PR.

---

## 🟠 Tuyos del 7 de agosto — confirmados ABIERTOS

- [ ] **A1 · Pasar lista todavía tiene el paso «3 Confirmar».**
  - **Verificado en vivo:** el stepper muestra «Horario · Lunes 15:00 / 2 Pasar
    lista / **3 Confirmar**», y la URL del paso existe
    (`?horario=1&paso=lista` → confirmar).
  - **Pero la mitad de tu pedido YA ESTÁ:** todos arrancan en Presente
    («14/16 presentes» sin tocar nada), hay botón «Marcar restantes
    presentes» y contador «11 alumnos sin revisar».
  - **Lo que falta es solo el tercer paso** y el guardado incremental.
  - **Dónde:** `frontend/src/app/trainer/attendance/page.tsx:176,1291,1361`.

- [ ] **A2 · Seis pantallas siguen importando el `BackLink` viejo.**
  - `trainer/attendance/history`, `admin/crear-cuenta`, `trainer/attendance`,
    `student/add-dependent`, `ayuda`, `student/enroll`.
  - **Cómo se verificó:** `rg -ln 'from "@/components/BackLink"' frontend/src`.
  - El nuevo tiene test propio desde #176 y casi nadie lo usa.

- [ ] **A3 · El panel del entrenador es dos tarjetas y un vacío.**
  - **Verificado en captura:** el 60 % inferior de la pantalla queda en blanco
    a 1440×900. Los cuatro conteos de la última lista van como `Badge` en fila,
    no en `StatGrid`.
  - **Dónde:** `frontend/src/app/trainer/page.tsx`.

- [ ] **A4 · Preguntas frecuentes es un muro de texto.**
  - **Verificado:** ~20 preguntas con respuesta larga, todas expandidas, más la
    tabla de horarios. «Volver al inicio» aparece **dos veces**, arriba y abajo.
  - **Acoplamiento que hay que mirar:** el FAQ afirma «la ficha médica la
    gestiona un administrador del club. Pídaselo y ellos la actualizan». Es
    cierto hoy, pero la API ya autoriza al representante — el día que la UI
    acompañe, este texto queda mintiendo.

- [ ] **A5 · `/student/payments` explica demasiado.**
  - **Verificado:** bajo los datos de la membresía hay un instructivo «Cómo se
    registra un pago» de tres pasos, cada uno un párrafo completo.

---

## 🟢 Tuyos del 7 de agosto — ya NO reproducen

Los verifiqué esperando encontrarlos y no estaban. **Sacalos de tu cabeza.**

| # | Hallazgo | Qué encontré hoy |
|---|---|---|
| **C1** | «Mejorar el dropdown de seleccionar alumno» | Ya es un `select` limpio con los 4 dependientes y la leyenda «Se mantiene en Mi cuenta, Pagos y Asistencias hasta que usted lo cambie» |
| **C2** | «Tomar lista: todos en Presente por defecto» | Implementado — «14/16 presentes» sin tocar nada, más «Marcar restantes presentes» y el contador de sin revisar |
| **C3** | «Dashboard de alumno con sobreingeniería» | Ya recortado: alerta de cobertura, próximos entrenamientos, carnet y dos accesos. Cerca de lo que pediste |
| **C4** | La franja del carnet | Correcta y derivada del horario real: «FRANJA 16:00 — 17:00» coincide con los próximos entrenamientos |

**C1 tiene un resto de código:** `ManagedStudentPicker.tsx` no declara estado
pendiente aunque consume el cliente API. Se ve bien, pero no confirma que la
acción ocurrió.

---

## ⚪ No llegué a probarlas — quedan para la próxima pasada

Las declaro para que no parezcan verificadas.

- El botón «Nuevo Horario» de `/groups`.
- El header de la ficha médica.
- `/student/attendance`.
- Los casos borde de reportes (un solo alumno, nombres largos).
- `/payments` y `/discounts` con el dataset grande.
- La app en pantalla angosta. **Todo lo de arriba se miró a 1440×900**; tus
  quejas de densidad del 7 de agosto salieron mirando en otro tamaño.

---

## Lo que necesito de vos

1. **Confirmá o tumbá los cuatro de la tabla verde.** Si alguno sigue
   molestándote, es que el problema no era el que quedó escrito, y quiero el
   enunciado nuevo.
2. **Decidí el alcance de N1** (¿el entrenador puede listar personas o no?).
3. **Recorré las cinco de la sección blanca**, que son las que no toqué.
4. Cuando cierres eso, armamos el plan de fixes.

Capturas de todo lo recorrido:
`/tmp/claude-1000/-home-alejo-devwork--projects-apps-cata-club/cac9b722-2365-49ca-b65b-2f1da5a26323/scratchpad/shots/`

El entorno queda levantado. Para volver a la base limpia: `make qa-reset`.
