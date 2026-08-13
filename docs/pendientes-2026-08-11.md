> ## ⛔ HISTÓRICO — superado el 2026-08-13
>
> Este documento fue el índice vivo de pendientes hasta el 13 de agosto de
> 2026. **Ya no se mantiene** y puede contener afirmaciones que no son
> ciertas contra el código actual (por ejemplo, su ítem sobre
> `docker-compose.prod.yml` sin TLS/límites/logs está resuelto desde antes
> de esta fecha).
>
> La **única lista viva** de preparación para producción es
> [`operations/production-readiness.md`](operations/production-readiness.md),
> verificada contra `fd9f7be` el 2026-08-13. No copiar ítems de este
> archivo sin re-verificarlos contra el código y la lista viva.

# Pendientes — al cierre del 11 de agosto de 2026

- **Base:** `main` local en `e863341`. **`origin/main` está en `e663953`** — 134
  commits de diferencia.
- **Reemplaza a** `docs/pendientes.md`, que quedó como archivo histórico y **ya
  no se mantiene**.
- **Regla:** un ítem se **borra** cuando está resuelto y su candado en verde. No
  se tacha. Un documento que acumula tachados vuelve a ser histórico.

Cómo se re-deriva: cada ítem lleva el comando que lo reproduce. Si no reproduce,
el ítem cambió y se actualiza acá, en el mismo PR que el código.

---

## 🔴 Bloqueante para producción — no para una demo

Nada de esto es producto. Es el despliegue, y sigue intacto desde el arranque de
la sesión. **Es un solo PR de infraestructura.**

- [ ] **`docker-compose.prod.yml` no completa el contrato de operación.**
  - Sin ingress con TLS, sin límites de memoria por servicio, sin rotación de
    logs. El propio encabezado del archivo los difiere «a la continuación de
    esta PR».
  - **Dónde:** `docker-compose.prod.yml:6-15`.
  - **Ojo con el grep:** el comentario dice `Caddy` con mayúscula; un
    `rg "caddy"` case-sensitive da vacío y hace parecer que ya está.
  - **Qué lo cierra:** extender `tests/test_docker_compose_config.py` —**en la
    raíz del repo, no bajo `backend/`**— con asserts de `mem_limit` y `logging`
    por servicio.
  - **Por qué bloquea:** sin TLS no hay producción, y sin límites un droplet de
    2 GB se queda sin RAM.

- [ ] **`.env.example` incompletos.**
  - Según el relevamiento: el `./.env.example` raíz no documenta `IMAGE_TAG`,
    `FRONTEND_URL` ni los seis `SMTP_*`; `RESET_HOSTS_PERMITIDOS` y
    `TEST_DATABASE_URL` no figuran en ninguno.
  - **Nunca se pudo verificar**: el entorno de trabajo deniega la lectura de
    `.env*`. **Correlo vos**:
    `rg -n "RESET_HOSTS_PERMITIDOS|TEST_DATABASE_URL|IMAGE_TAG|FRONTEND_URL|SMTP_" .env.example backend/.env.example frontend/.env.local.example`
  - **Por qué bloquea:** quien despliegue no tiene forma de saber qué exportar.

- [ ] **Sin métricas ni trazas.**
  - La correlación existe (`X-Request-ID` en toda respuesta, #144). Las otras
    dos patas, no.
  - **Cómo se verifica:** `rg -ln "prometheus|opentelemetry|statsd" backend/` → vacío.
  - **Por qué bloquea:** desplegás a ciegas; si producción falla, te enterás
    porque avisa un socio.

---

## 🟠 Decisiones tuyas, antes de tocar código

- [ ] **Publicar.** Los 134 commits viven solo en tu máquina. Según las reglas
  del repo son ~27 ramas con su issue y su PR. Respaldos para volver:
  `respaldo/pre-integracion`, `-2`, `-3`.

- [ ] **Terminar tu recorrido.** En los minutos que miraste encontraste **dos
  defectos reales** que ninguna de las dos auditorías había visto: el botón
  «Nuevo Horario» que no podía crear nada, y la columna «Estado» vacía. Los dos
  ya están arreglados — pero el recorrido quedó a medias, y es el mejor detector
  que tenemos.

---

## 🟡 Residuos conocidos — reales, acotados, documentados

- [ ] **El 422 de Pydantic llega en inglés y como arreglo.**
  - Un rechazo con nota inválida, o una contraseña corta al agregar dependiente,
    caen a un genérico. FastAPI emite el `detail` como **arreglo**, y las puertas
    del cliente exigen texto.
  - **Es estructural:** 31 rutas BFF comparten `passthroughBackendError` contra
    8 esquemas con más de 50 campos restringidos.
  - **Qué lo cierra:** un handler de `RequestValidationError` en
    `backend/main.py` que traduzca y devuelva texto. Toca cómo se ven **todos**
    los errores de validación: merece su propio PR y su decisión.

- [ ] **Los comprobantes ya subidos conservan su URL pública.**
  - El arreglo protege lo nuevo: los archivos suben como `authenticated` y la
    URL se firma al leerla. Las filas viejas se detectan por su prefijo `http` y
    se dejan pasar sin romperlas.
  - **Qué lo cierra:** una migración de datos, y **exige credenciales reales de
    Cloudinary**, que este entorno no tiene.
  - **Riesgo:** si alguna vez se subieron comprobantes reales a una cuenta real,
    esos siguen expuestos hasta migrarlos.

- [ ] **`Asistencia` no guarda quién tomó la lista.**
  - Hoy no se puede saber quién marcó ausente a un chico. Es deliberado en el
    modelo (`modelos.py:536`), pero mezcla dos cosas: *quién dictó la clase* —lo
    que se decidió no guardar, por cómo se le paga al entrenador— y *quién tipeó
    la lista*, que es auditoría.
  - **Qué lo cierra:** una columna `registrado_por` y su migración. Se justifica
    por trazabilidad, no por ninguna pantalla.

- [ ] **El correo no se puede ejercitar en QA.**
  - `QA_SERVICIOS` deja los workers de Celery afuera a propósito, para ahorrar
    memoria. **En producción sí están.** Dos auditores independientes lo
    reportaron como bloqueante antes de que `make qa-up` lo avisara en su salida.
  - **Qué lo cierra:** nada urgente. Está señalizado, que era el problema real.

- [ ] **Un quinto cálculo de edad sin unificar.**
  - `student-utils.ts::isMinor` hace su propio cálculo. No tiene el defecto del
    `NaN` —opera sobre datos ya validados— pero es el quinto lugar que calcula
    lo mismo.
  - **Y dos techos de edad faltantes**, estructuralmente parecidos a los que se
    cerraron: `persona_servicio.py:107` y `admin_cuenta_servicio.py:112`.

- [ ] **Las capturas del fix 23 quedaron como marcadores.**
  - `docs/fixes/img/23-*-antes.png` y `-despues.png` no se generaron: el agente
    no tenía navegador disponible y **prefirió no fabricar archivos falsos**. El
    fix está verificado por tests y a mano; falta solo la evidencia visual.

---

## ⚪ Deuda que no bloquea nada

- [ ] **Dos sistemas de tokens de color conviven** — `cata-*` y La Paleta.
  Re-derivá el conteo antes de tocar; bajaba solo con cada rediseño.
  `rg -o '\b(?:bg|text|border|ring|from|via|to|divide|fill|stroke|hover:bg|hover:border|hover:text)-cata-[a-z0-9-]+' frontend/src --glob '!**/__tests__/**' -l | wc -l`
- [ ] **Rutas BFF duplicadas en dos idiomas** — `asistencias`/`attendance`,
  `membresias`/`payments`, `members`/`personas`. Más `api/ranking/`, cuyo nombre
  ya no describe nada: la feature se borró en #165 y la URL se conservó a
  propósito.
- [ ] **El mock de `next/image` duplicado en 19 archivos de test.** El cierre es
  moverlo a `test-setup.ts` una vez y borrar las 19 copias.
- [ ] **El `afterEach` de `test-setup.ts` limpia todo `localStorage`**, no solo
  las claves de preferencia, y su `catch` se traga cualquier error.
- [ ] **Dos sesiones de pytest concurrentes colisionan** — la fixture hace
  `DROP SCHEMA public CASCADE` sin discriminar por proceso. Nos mordió de verdad
  esta sesión, con varios agentes en paralelo. El arnés de migraciones sí
  discrimina por PID (`_sufijo_de_proceso`): replicarlo en `esquema_migrado`.
- [ ] **`/discounts` no se adapta a 390 px** — hay que descubrir un scroll
  horizontal dentro de la fila para llegar a «Desactivar».
- [ ] **`/discounts` y `/student/payments` tienen párrafos explicativos
  permanentes.** `/payments` (admin) resuelve bien el mismo caso: enlaza a
  `/ayuda` en vez de repetir el texto. Ese es el patrón a copiar.
- [ ] **Los números van centrados** en `/members` y `/payments`, cuando la regla
  del sistema es número a la derecha.
- [ ] **El `BackLink` nuevo sigue en cero usos de producción.** Se construyó con
  test propio y nunca se migró ninguna pantalla.
- [ ] **En pasar lista, los botones de estado pierden su palabra en escritorio**
  — `sm:sr-only` la esconde desde 640 px. En teléfono se ve; en la computadora,
  no.

---

## 🤔 Decisiones de negocio sin tomar

Ninguna se resuelve escribiendo código.

- [ ] **Borrado de `Persona`: ¿lógico o duro con `RESTRICT`?** `Persona.activo`
  existe y la baja lógica funciona, pero nunca se decidió.
- [ ] **¿Vuelve la franja a `/student/payments`, derivada?** #160 la eliminó con
  un motivo explícito. Lo abierto es si vuelve derivada de los `alumno_horario`,
  como en el carnet, o si se acepta que viva solo en `/student`.
- [ ] **Qué operaciones administrativas existen realmente.** El caso testigo
  —«Crear horario»— **ya se resolvió** esta sesión. Quedan con el mismo criterio:
  alta de tipos de membresía, alta de instituciones.

---

## Dónde está el resto

| | |
|---|---|
| `docs/cierre-sesion-2026-08-11.md` | Qué se hizo, qué se decidió, y las lecciones |
| `docs/auditoria-qa/README.md` | La primera auditoría, con capturas |
| `docs/decisiones-de-negocio-2026-08-11.md` | Las ocho decisiones con su porqué |
| `docs/fixes/` | 24 documentos, uno por arreglo |
| `docs/fixes/00-INTEGRACION*.md` | Las tres integraciones y sus conflictos |
| `docs/pendientes.md` | **Histórico. No se mantiene.** |
