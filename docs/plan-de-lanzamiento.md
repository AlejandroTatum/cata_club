> ## ⛔ HISTÓRICO — superado el 2026-08-13
>
> Este plan se re-derivó el 10 de agosto y ya **no se mantiene**: varios de
> sus ítems están resueltos o desactualizados contra el código actual, y su
> «bloqueante» de infraestructura (TLS, `mem_limit`, logs) está implementado
> desde antes de esta fecha.
>
> La **única lista viva** de preparación para producción es
> [`operations/production-readiness.md`](operations/production-readiness.md),
> verificada contra `fd9f7be` el 2026-08-13. No copiar ítems de este
> archivo sin re-verificarlos contra el código y la lista viva.

# Plan de lanzamiento a producción — Cata Club

- **Base verificada:** `origin/main` en `e663953`
- **Re-derivado:** 10 de agosto de 2026
- **Cómo se usa:** cada ítem se saca de este archivo cuando su fix está
  mergeado y su candado en verde. No se marca `[x]`: se borra. Un documento
  que acumula tachados vuelve a ser un archivo histórico, y ese ya existe
  (`docs/pendientes.md`).

Cada ítem lleva una marca de derivación:

| Marca | Significa |
|---|---|
| ✅ | Re-derivado hoy contra `e663953`. El comando corrió y la evidencia reprodujo. |
| ⚠️ | Heredado de `docs/pendientes.md` sin re-derivar hoy. Es hipótesis hasta correr su comando. |
| 🚫 | No se pudo verificar acá (permisos u otra causa). Requiere verificación manual. |

La severidad de este documento mide **qué bloquea el lanzamiento**, no
consecuencia sobre los datos. Es distinta de la de `docs/pendientes.md`, a
propósito: ahí no hay un solo ítem Bloqueante ni Alto, y aun así hay tres
cosas sin las cuales no se despliega.

---

## 🔴 Bloqueantes — sin esto no se lanza

- [ ] **`.env.example` incompletos.** 🚫
  - **Qué falta:** según el relevamiento anterior, el `./.env.example` raíz —el
    que lee docker-compose— no documenta `IMAGE_TAG`, `FRONTEND_URL` ni los
    seis `SMTP_*`; y `RESET_HOSTS_PERMITIDOS` y `TEST_DATABASE_URL` no figuran
    en ningún example.
  - **Dónde:** `./.env.example`, `backend/.env.example`,
    `frontend/.env.local.example`.
  - **Cómo se verifica:**
    `rg -n "RESET_HOSTS_PERMITIDOS|TEST_DATABASE_URL|IMAGE_TAG|FRONTEND_URL|SMTP_" .env.example backend/.env.example frontend/.env.local.example`
  - **No se pudo verificar acá:** el entorno deniega la lectura de `.env*`.
    **Correlo vos antes de tocar nada** — este ítem entra al plan como
    hipótesis, no como hecho.
  - **Qué lo cierra:** un test de paridad example-vs-`configuracion.py`: toda
    variable consumida por compose o por settings figura en su example.
  - **Por qué bloquea:** quien despliegue no tiene forma de saber qué exportar.
    Un `CORS_ORIGENES` mal puesto bloquea el frontend entero en silencio.

- [ ] **Sin métricas ni trazas.** ✅
  - **Qué falta:** las dos patas de observabilidad que no se cerraron. La
    correlación sí existe (`X-Request-ID` en toda respuesta, disponible en
    `request.state`, cerrado en #144), así que ambas son incrementales sobre
    el `request_id` que ya viaja.
  - **Dónde:** `backend/main.py:141-165` es lo que hay; no hay dónde anclar lo
    que falta.
  - **Cómo se verificó:** `rg -ln "prometheus|opentelemetry|statsd" backend/`
    → vacío.
  - **Qué lo cierra:** el test que traiga el cierre (p. ej. `/metrics`
    responde y expone contadores por ruta).
  - **Por qué bloquea:** desplegás a ciegas. Si producción falla, el modo de
    enterarse es que un socio avise.

---

## 🟠 Lo que ves usando la app — hallazgos de la prueba a mano

Origen: **el recorrido a mano del 7 de agosto de 2026**, en QA. Veinte
hallazgos reportados por el dueño usando el sistema, no por una auditoría de
código. **Diez siguen abiertos** y están abajo, cada uno re-verificado hoy.

Estos importan distinto del resto del documento: son lo único de la lista que
un socio ve. Ninguno rompe datos, pero el producto se juzga acá.

- [ ] **Tomar lista todavía tiene pantalla de confirmación.** ✅
  - **Qué pediste:** todos en Presente por defecto, guardado incremental, y
    **sin** pantalla de confirmación.
  - **Qué hay:** el paso de confirmación sigue entero — «Revise el resumen
    antes de confirmar el registro de asistencia», un botón «Confirmar y
    finalizar» y hasta una ruta `?paso=confirmar`.
  - **Dónde:** `frontend/src/app/trainer/attendance/page.tsx:176,1291,1361`
    (el paso y sus textos); `:459` (la ruta del paso).
  - **Qué lo cierra:** el test de que marcar asistencia persiste sin pasar por
    un segundo paso, y que el estado inicial de cada alumno es Presente.
  - **Ojo:** es el hallazgo más grande de los diez. Cambia el flujo, no la
    pintura — no lo metas en la misma pasada que un rediseño de pantalla.

- [ ] **Dos `BackLink` conviven y el nuevo casi no se usa.** ✅
  - **Qué pediste:** UN botón «Volver», que nombre el destino.
  - **Qué hay:** el componente nuevo existe con test propio (#176), pero
    **seis pantallas siguen importando el viejo** `@/components/BackLink`:
    `trainer/attendance/history`, `admin/crear-cuenta`, `trainer/attendance`,
    `student/add-dependent`, `ayuda`, `student/enroll`.
  - **Cómo se verificó:** `rg -ln 'from "@/components/BackLink"' frontend/src`
    → seis archivos.
  - **Qué lo cierra:** migrar las seis y borrar `components/BackLink.tsx`. Su
    desaparición es el candado: no se puede importar lo que no existe.

- [ ] **El dropdown de seleccionar alumno.** ✅
  - **Qué pediste:** mejorarlo.
  - **Qué hay:** 243 líneas, y —el hallazgo nuevo de hoy— **no declara ningún
    estado pendiente** aunque consume el cliente API, así que la selección no
    confirma que ocurrió.
  - **Dónde:** `frontend/src/app/student/ManagedStudentPicker.tsx`.
  - **Qué lo cierra:** el barrido de estados pendientes convertido en test
    (ver el ítem gemelo en Menores) más lo que decidas del rediseño.
  - **Este es el que yo movería antes de abrir producción.** Es lo más barato
    de la lista y es lo primero que toca un representante con dos hijos.

- [ ] **Dashboard de entrenador desorganizado.** ✅
  - **Qué pediste:** tomar el de admin como referencia de forma.
  - **Qué hay:** `trainer/page.tsx:43` importa `Badge, Button, EmptyState,
    ErrorState, LoadingState, buttonClasses` — ningún primitivo de tarjeta ni
    de grilla.
  - **Qué lo cierra:** un test de la pantalla, con el patrón de #176-#180.

- [ ] **Dashboard de alumno con sobreingeniería.** ✅
  - **Qué pediste:** reducirlo a la card de membresía y accesos rápidos. Es un
    recorte de información, no una migración de componentes.
  - **Qué hay:** `student/page.tsx:22` importa `EmptyState, ErrorState,
    LoadingState, PAGE_RAIL, buttonClasses` — sin `StatGrid`, `MemberCard` ni
    `DataBox`, y con todo el resto del contenido todavía en pantalla.
  - **Qué lo cierra:** el test de que la pantalla renderiza la card y los
    accesos, y **no** las secciones recortadas.

- [ ] **`/student/payments` más simple.** ⚠️ No re-derivado hoy.
- [ ] **`/student/attendance`: sobra texto.** ⚠️ No re-derivado hoy.
- [ ] **Preguntas frecuentes: demasiado texto.** ⚠️ No re-derivado hoy.
  Además importa el `BackLink` viejo (ver arriba) — misma pasada.
- [ ] **El header de la ficha médica es muy plano.** ⚠️ No re-derivado hoy.
- [ ] **El botón de agregar horario en `/groups`.** ⚠️ Quedó diferido hasta
  después de M1, que ya cerró (#170/#173/#179). Toca auditarlo contra el
  sistema nuevo.

**Regla que saliste vos de esa sesión y sigue valiendo:** el rediseño de una
pantalla y la migración de sus tokens `cata-*` **van en la misma pasada**.
Hacerlos por separado significa tocar cada línea dos veces.

**Los otros diez hallazgos ya están cerrados:** ficha médica (#174), formulario
de descuentos (#174), inscripción por mes (#182/#183), efectivo solo del socio
(#175), los seis componentes del sistema visual (#176-#178), alineación de
tabla (#177), densidad del perfil (#180), columna Contacto de `/members`
(#185), y los dos de la cola de validación de pagos (#188).

---

## 🐛 Issues abiertos en GitHub

Dos, y ninguno estaba en este documento.

- [ ] **#197 — el plazo del BFF para generar un PDF es el mismo que para
  autenticar (10 s).** Etiquetado `enhancement`. Un reporte grande tarda más
  que un login, y comparten deadline.
- [ ] **#111 — no existe bloqueo por cuenta tras N intentos fallidos de
  login.** Etiquetado `enhancement`, pero **es seguridad**: sin límite de
  intentos, la fuerza bruta contra una cuenta no encuentra freno. Decidí vos
  si esto sube a bloqueante antes de exponer la app a internet.

---

## 🟡 Medios — no bloquean el deploy, encarecen todo lo que venga después

- [ ] **`categoria_horario` promete extensibilidad y lanza `ValueError`.** ✅
  - **Qué está mal:** la categoría se movió a tabla «para que el club pueda
    sumar una categoría nueva sin un deploy de código», y es cierto para horas
    y días. No lo es para filtrar ni para mostrar: el filtro del listado sigue
    tipado contra el enum Python `Categoria` (FastAPI responde 422 a cualquier
    código nuevo), y `categoria_en_castellano` hace `_CATEGORIAS[Categoria(...)]`
    sin `try`, así que **lanza** en vez de degradar.
  - **Dónde:** `backend/app/presentacion/routers/asistencias_router.py:83`;
    `backend/app/dominio/etiquetas.py:50-56,71-72`; el docstring que promete lo
    contrario en `backend/app/dominio/modelos.py:461-463`.
  - **Qué lo cierra:** un test que siembre una sexta fila en `categoria_horario`
    con un código fuera del enum y afirme dos cosas hoy falsas: que
    `GET /asistencias/horarios?categoria=<nueva>` no responde 422, y que
    `categoria_en_castellano("<nueva>")` devuelve un nombre.

- [ ] **`Pago` no registra quién lo creó: la regla del efectivo no tiene red.** ✅
  - **Qué está mal:** la regla de #175 —«un pago EFECTIVO es la declaración de
    quien entregó el dinero»— vive solo en el servicio. `Pago` no tiene columna
    de creador (`persona_id` es el titular al que se imputa, no quien lo
    escribió), así que no hay forma de reconstruir desde la base quién declaró
    un efectivo, ni de respaldar la regla con un `CHECK` si un INSERT la
    esquivara.
  - **Dónde:** `backend/app/dominio/modelos.py:327-373` (ninguna columna
    `registrado_por`/`creado_por_persona_id`); la regla sin red en
    `backend/app/servicios_negocio/membresia_pago_servicio.py:252-260`.
  - **Qué lo cierra:** agregar la columna y un test de integración que la haga
    `NOT NULL` en el camino de EFECTIVO. Hoy no hay dato que auditar.

- [ ] **`GET /ranking/notificaciones/mias` devuelve `List[...]` sin paginar.** ✅
  - **Qué está mal:** las notificaciones crecen monótonamente por usuario y el
    endpoint las devuelve enteras, sin `skip`/`limit`. A diferencia de los
    catálogos exentos, acá no hay comentario que lo funde como deliberado.
  - **Dónde:** `backend/app/presentacion/routers/notificaciones_router.py:27-35`.
    **Corrección de path:** el documento viejo lo ubicaba en
    `ranking_router.py:134-146`, archivo que **no existe** — la feature de
    ranking se eliminó entera en `8354ac4` (#165). La URL pública se mantuvo a
    propósito (el docstring del router nuevo lo explica), el módulo no.
  - **Qué lo cierra:** los cuatro del patrón de
    `backend/tests/test_paginacion_listados.py` (envelope, tope de `limit`,
    paginación sin solape con orden estable) aplicados a esta ruta.

- [ ] **Rutas BFF duplicadas en dos idiomas, más un directorio con nombre muerto.** ✅
  - **Qué está mal:** tres pares espejo entre los 16 directorios de API —
    `asistencias`/`attendance`, `membresias`/`payments`, `members`/`personas`.
    Es una de las costuras que ya produjo defectos reales.
  - **Sumado hoy:** `frontend/src/app/api/ranking/` sigue en pie (cuatro
    archivos, notificaciones y su test) aunque el backend borró ranking en
    #165. No es código muerto —la URL se conservó a propósito— pero el nombre
    del directorio ya no describe nada.
  - **Dónde:** `frontend/src/app/api/` (los seis directorios de los pares, más
    `ranking/`).
  - **Cómo se verificó:** `fd -t d . frontend/src/app/api --max-depth 1` → 16
    directorios; `fd -t f . frontend/src/app/api/ranking` → 4 archivos.
  - **Qué lo cierra:** tras consolidar, un inventario de rutas que afirme un
    solo directorio por dominio y se ponga rojo si reaparece un espejo.

- [ ] **La interfaz de fichas médicas sigue restringida a administradores.** ✅
  - **Qué está mal:** la API ya autoriza al representante a leer y actualizar
    la ficha de su representado, con tests de aislamiento entre familias. La UI
    no acompañó: `MedicalRecordEditor` vive solo bajo `members/`, y ninguna
    ruta de `app/student/**` lo importa.
  - **Dónde:** `frontend/src/app/members/MedicalRecordEditor.tsx`; su único
    consumidor de producto es `frontend/src/app/members/page.tsx`.
  - **Cómo se verificó:** `rg -ln 'MedicalRecordEditor' frontend/src` → cuatro
    archivos: el componente, `members/page.tsx`, su test unitario y
    `lib/__tests__/color-contrast.test.ts`. Ninguno bajo `student/`.
  - **Qué lo cierra:** el test de la vista del representante que renderiza el
    editor para su representado y niega el ajeno.

- [ ] **Dos sistemas de tokens de color conviven: `cata-*` y La Paleta.** ✅
  - **Qué está mal:** 315 usos de tokens `cata-*` en posición de clase, en 36
    archivos; 14 archivos mezclan ambos sistemas en el mismo componente.
    Ningún guardián lo frena: `color-contrast.test.ts` vigila hex crudos y
    colores Tailwind con nombre, pero `cata-*` es un token legítimo y pasa
    limpio, así que la mezcla puede crecer.
  - **Números corregidos:** el documento viejo decía 449 usos / 37 archivos /
    20 mezclados. Bajó solo, por los rediseños de pantalla ya mergeados.
    **Este es el único lugar donde vive el conteo** — si lo necesitás en otro
    lado, re-derivalo, no lo copies.
  - **Dónde:** `frontend/src/components/ui/Button.tsx:43` (su variante
    `primary` entera es `cata-*`); `frontend/src/components/shell/AppShell.tsx`.
  - **Cómo se verificó:**
    `rg -o '\b(?:bg|text|border|ring|from|via|to|divide|fill|stroke|hover:bg|hover:border|hover:text)-cata-[a-z0-9-]+' frontend/src --glob '!**/__tests__/**' | wc -l`
    → 315; el mismo con `-l | wc -l` → 36; la intersección con
    `\b(bg|text|border|ring|fill|stroke)-(ball|coal|paper|sunken|canvas)\b`
    → 14.
  - **Qué lo cierra:** un presupuesto que solo baja, con el patrón
    `RAW_PALETTE_DEBT` que ya usa `color-contrast.test.ts:593`.
  - **No se cierra solo:** baja pantalla por pantalla, en la misma pasada que
    el ítem de abajo.

- [ ] **Casos borde de reportes sin cubrir.** ⚠️
  - **Qué está mal:** de los cuatro casos que pediste probar —sin datos, un
    solo alumno, rango sin asistencias, nombres largos— dos ya tienen test
    (`frontend/src/app/reports/__tests__/ReportsPage.test.tsx:213,244`) y dos
    no: un solo alumno, y nombre largo.
  - **Qué lo cierra:** esos dos casos en `ReportsPage.test.tsx`.

> **Las pantallas sin el sistema visual nuevo no viven acá.** Están arriba, en
> «Lo que ves usando la app», con nombre y evidencia propia por pantalla. Este
> documento no repite un hecho en dos lugares: esa es exactamente la falla que
> pudrió a `docs/pendientes.md`.

- [ ] **Deuda del colapso del descuento (#166): tres huecos.** ⚠️
  1. El backfill de `ade8e3c117ca` asume «un pago tiene a lo sumo una fila en
     `descuento_aplicado`» apoyado solo en su docstring; ningún test reproduce
     un `Pago` con dos `DescuentoAplicado`.
  2. `descuento_autorizado_por_persona_id` quedó nullable donde el
     `autorizado_por_persona_id` que reemplazó era `NOT NULL`: la migración
     aflojó una restricción sin que conste si fue deliberado.
  3. El `CHECK ck_pago_descuento_valor_congelado` es asimétrico: cubre
     «`descuento_id` sin `descuento_valor_aplicado`» pero no el inverso.
  - **Dónde:** `backend/alembic/versions/ade8e3c117ca_*.py:7-10,59-64`;
    `backend/app/dominio/modelos.py:401-403` (la columna) y `:351-354` (el
    `CHECK`, cuya línea sí confirmé hoy).
  - **⚠️ Los tres puntos vienen heredados;** solo verifiqué que el
    `CheckConstraint` sigue en `modelos.py:351`.
  - **Qué lo cierra:** tres tests, uno por punto.

- [ ] **Cuatro colisiones de nombres.** ⚠️
  1. `TipoMembresia.categoria` (texto libre comercial) contra
     `HorarioEntrenamiento.categoria` (FK a `categoria_horario.codigo`). Esta
     ya produjo un defecto real y es la razón por la que #160 eliminó
     `franja_horaria`.
  2. `ServicioNotificaciones` (adaptador SMTP, infraestructura) contra
     `NotificacionServicio` (feed in-app, negocio).
  3. `MembershipStatus` duplica a `EstadoMembresia` bajo otro nombre, sin alias
     de tipo que los ate; y `"suspendida"` es rama muerta en ambos.
  4. `STAT_GRID` (cadena de clases) contra `StatGrid` (componente React), las
     dos exportadas desde el mismo barrel.
  - **⚠️ No re-derivado hoy.**
  - **Qué lo cierra:** para la 3, un test que afirme que
    `MEMBERSHIP_STATUS_BY_ESTADO` nunca produce `"suspendida"` hoy, para que
    borrarla o cablearla sea explícito. Para las otras tres, un renombre cada
    una: son de nombres, no de comportamiento, y no hay candado barato.

- [ ] **31 migraciones con tres merges de heads.** ✅
  - **Qué está mal:** no es un defecto —cada migración individual es
    correcta—, es una tendencia: cada fusión es evidencia de dos ramas que
    tocaron el esquema en paralelo sin coordinarse.
  - **Cómo se verificó:** `fd -e py . backend/alembic/versions | wc -l` → 31;
    `rg -c 'down_revision.*= \(' backend/alembic/versions/*.py` → 3 archivos
    con tupla.
  - **Qué lo cierra:** nada retroactivo. Hacia adelante lo sostiene la revisión
    de PR: planificar las migraciones de una feature como secuencia lineal
    desde el diseño, no como fusiones a posteriori.

---

## ⚪ Menores — deuda de forma, sin consecuencia observable hoy

- [ ] **`ManagedStudentPicker` no declara estado pendiente.** ✅ **(nuevo)**
  - **Qué está mal:** consume `@/services/api` y no expone ninguna bandera de
    carga, así que su acción no confirma que ocurrió. El barrido que el
    documento anterior daba **vacío** ahora devuelve este archivo.
  - **Dónde:** `frontend/src/app/student/ManagedStudentPicker.tsx`.
  - **Cómo se verificó:**
    `for f in $(rg -ln 'from "@/services/api"' frontend/src/app --glob '*.tsx' | rg -v __tests__); do rg -q 'saving|isPending|submitting|Guardando|busy|loading' "$f" || echo "NO-PENDING: $f"; done`
    → un resultado.
  - **Qué lo cierra:** ese mismo barrido convertido en test estilo
    `focus-ring-usage` — cierra el hueco y obliga a la página 23.

- [ ] **El `afterEach` de `test-setup.ts` limpia TODO `localStorage`.** ✅
  - **Qué está mal:** hace `window.localStorage.clear()` sin filtrar por
    prefijo, así que borra cualquier clave y no solo las `cata:pref:*` que
    motivaron el fix. Y su `catch` está vacío para cualquier excepción, no solo
    la de Node 26 que documenta el comentario de al lado: un error real de
    `localStorage` en CI se tragaría igual, sin log.
  - **Dónde:** `frontend/src/test-setup.ts:30` (el `clear`), `:31-34` (el
    `catch`).
  - **Qué lo cierra:** un test que siembre una clave fuera de `cata:pref:*` y
    afirme que sobrevive; y uno que fuerce un error distinto al de Node 26 y
    afirme que se re-lanza.

- [ ] **El mock de `next/image` está duplicado en 19 archivos de test.** ✅
  - **Dónde:** 19 archivos bajo `__tests__/`, cada uno con su propio
    `vi.mock("next/image", ...)` y variaciones menores.
  - **Cómo se verificó:**
    `rg -l 'vi\.mock\("next/image"' frontend/src --glob '**/__tests__/**' | wc -l`
    → 19.
  - **Qué lo cierra:** ningún test —es duplicación, no comportamiento—. El
    cierre es moverlo a `test-setup.ts` una vez y borrar las 19 copias, con la
    suite completa en verde como evidencia.

- [ ] **El patrón MIME incluye `audio` y `video`, que son palabras españolas.** ✅
  - **Qué está mal:** el comentario funda la lista cerrada de nueve tipos IANA
    en que «`palabra/palabra` a secas no es un MIME en español». El argumento
    vale para `application`, `font`, `image`, `message`, `model`, `multipart` y
    `text`. No vale para `audio` ni `video`: «audio/visual» en una frase
    corriente dispara el patrón y esconde el `detail` tras el fallback.
  - **Consecuencia hoy, ninguna:** ni `backend/app` ni `frontend/src` contienen
    esas palabras fuera del propio patrón.
  - **Dónde:** `frontend/src/lib/error-message.ts:110` (el documento viejo
    decía `:109`; el archivo se movió una línea).
  - **Qué lo cierra:** en `error-message.test.ts`, al lado del caso de
    `lunes/miércoles`. Exige decidir antes el arreglo —sacar los dos tipos, o
    exigir un subtipo IANA plausible después de la barra—, porque el test se
    escribe distinto según cuál se tome.

- [ ] **Dos sesiones de pytest concurrentes contra un mismo Postgres colisionan.** ✅
  - **Qué está mal:** la fixture de sesión ejecuta `DROP SCHEMA public CASCADE`
    sobre la única base de `TEST_DATABASE_URL`, sin discriminar por proceso. La
    asimetría duele: el arnés de migraciones sí discrimina por PID
    (`_sufijo_de_proceso`), la suite principal no. No afecta a CI (un proceso y
    una base por job).
  - **Dónde:** `backend/tests/conftest.py:175`.
  - **Qué lo cierra:** replicar `_sufijo_de_proceso` en `esquema_migrado`;
    su candado es el test del arnés extendido a la suite principal.

- [ ] **Mensajes de 404 que nombran la implementación.** ⚠️
  - **Qué está mal:** el PR que sacó el vocabulario de implementación se limitó
    a los status de entrada (400/409/422), los únicos cuyo `detail` el frontend
    deja pasar. Los `EntidadNoEncontrada` quedaron como estaban, con el
    identificador crudo adentro.
  - **Consecuencia hoy, ninguna:** un 404 se explica solo, así que
    `toUserMessage` lo reemplaza por la frase del frontend y el `detail` nunca
    se lee. Se vuelve vivo el día que alguien remapee `EntidadNoEncontrada` a
    400, y ese día `test_vocabulario_en_mensajes_de_usuario.py` se pone rojo
    solo.
  - **⚠️ El conteo no se pudo re-derivar:** el documento viejo decía 36
    mensajes. Hoy hay 53 `raise EntidadNoEncontrada` repartidos en 11 servicios
    (los concentran `asistencia_servicio.py` con 13,
    `membresia_pago_servicio.py` con 11 y `geografia_servicio.py` con 6). Son
    métricas distintas —sitios de `raise` contra mensajes que disparan la
    guarda—; re-derivá con el barrido de la guarda antes de tocar.
  - **Qué lo cierra:** ampliar `STATUS_DE_ENTRADA` en
    `test_vocabulario_en_mensajes_de_usuario.py` a todos los status y borrar el
    recorte.

- [ ] **El 422 tiene dos bloqueos independientes, no uno.** ⚠️
  - **Qué está mal:** los cuatro `ValueError` de `membresia_pago_schemas.py` ya
    están reescritos, pero su texto no llega igual. Primero, FastAPI emite el
    422 con `detail` **arreglo**, y las dos puertas del cliente exigen string
    (`isApiErrorBody` en `services/api.ts`, `passthroughBackendError` en
    `lib/server/backend-client.ts`), así que caen al fallback. Segundo, aunque
    se arreglara la forma, Pydantic antepone `"Value error, "` al mensaje, y
    ese prefijo dispara solo el patrón de inglés de `IMPLEMENTATION_VOCABULARY`.
  - **Arreglar uno sin el otro no muestra nada.**
  - **Qué lo cierra:** dos tests —uno de backend que fije la forma del cuerpo,
    otro de frontend sobre el prefijo de Pydantic—, y son de PRs distintos.

- [ ] **Una pestaña con el bundle anterior muestra datos incorrectos sin error.** ⚠️
  - **Qué está mal:** inherente al modelo de despliegue del frontend; se
    resuelve al recargar. Sin anclaje puntual de código: es una propiedad del
    contrato sin versionar entre bundle y API.
  - **Qué lo cierra:** ningún test razonable al costo de hoy. Cerrarlo es
    versionar el contrato, o **aceptarlo formalmente** y moverlo a decisiones.
    Se queda acá para que la aceptación sea explícita, no un olvido.

---

## 📋 Cerrados sin candado — falta el test, no el fix

Están resueltos o decididos en el código, pero nada se pone rojo si se
deshacen.

- [ ] **Los catálogos deliberadamente sin paginar no tienen quien funde la
  decisión.** ✅
  - **Qué está mal:** `GET /membresias/tipos` y `GET /personas/{id}/representados`
    están documentados en código como deliberadamente sin paginación, pero
    ningún test afirma la forma `List[...]`: alguien puede paginarlos —rompiendo
    a los llamadores que necesitan el conjunto completo— sin que nada se queje.
  - **Corrección:** eran tres. `GET /ranking/niveles` se fue con la feature en
    #165; quedan dos.
  - **Dónde:** `backend/app/presentacion/routers/personas_router.py:303`,
    `backend/app/presentacion/routers/membresias_pagos_router.py:62`.
  - **Cómo se verificó:** `rg -n "Deliberadamente SIN paginar" backend/app/presentacion/routers/`
    → dos resultados.
  - **Qué lo cierra:** un test por endpoint que afirme respuesta como lista
    plana, sin envelope.

- [ ] **La decisión de `alt=""` en los logos no tiene quien la funde.** ✅
  - **Qué está mal:** nada; la decisión es correcta (los logos son decorativos,
    el nombre del club ya está como texto adyacente). Pero una versión anterior
    del documento ya la revirtió una vez en prosa, y sin test la próxima
    «corrección» bienintencionada pasa limpia.
  - **Dónde:** `frontend/src/app/landing/LandingPage.tsx:69,313`;
    `frontend/src/app/student/page.tsx:158-164` (el documento viejo decía
    `:142-148`; el razonamiento está escrito en el código, en `:158`).
  - **Qué lo cierra:** un test que afirme `alt=""` en los tres logos y la
    presencia del texto adyacente que los vuelve redundantes.

---

## 🤔 Decisiones de negocio — no se resuelven escribiendo código

Ninguna es un fix. Requieren definición tuya; cuando se tomen, la decisión se
registra y —donde aplique— se funde con un test.

- [ ] **Borrado de `Persona`: ¿lógico o duro con `RESTRICT`?** `Persona.activo`
  existe y la baja lógica funciona, pero nunca se decidió: no hizo falta.
  `backend/app/dominio/modelos.py:149`.

- [ ] **Vincular una cuenta de menor ya creada a su representante.**
  `POST /personas/{id}/representados` solo da de alta un representado nuevo;
  una menor que se autogestionó la cuenta no tiene vinculación posterior. Falta
  el flujo: ¿quién aprueba?, ¿cómo se demuestra el vínculo?

- [ ] **¿Vuelve la franja a `/student/payments`, derivada?** #160 la eliminó
  con un motivo explícito (esa pantalla no tiene los horarios a mano, y un plan
  ahí es un precio). Lo abierto es si vuelve derivada de los `alumno_horario`
  del alumno, como en el carnet, o si se acepta que viva solo en `/student`.
  `frontend/src/app/student/payments/page.tsx:162-166`.

- [ ] **Qué operaciones administrativas existen realmente en el negocio.**
  Caso testigo: «Crear horario» no crea un horario (son cinco, fijos) — asigna
  un entrenador a una categoría existente. Mismos candidatos: alta de tipos de
  membresía, alta de instituciones. Ver `docs/hallazgos-post-presentacion.md`
  §2 y §4.

---

## Lo que se sacó de la lista al re-derivar

Tres ítems que `docs/pendientes.md` daba por abiertos y **no lo están**. Se
documentan acá para que nadie los reponga.

1. **El enlace de salto de `AppShell` sí tiene test de comportamiento.**
   `frontend/src/components/shell/__tests__/AppShell.test.tsx:139-169`, dos
   tests: que es el primer elemento enfocable del DOM, y que apunta al landmark
   `main` con `tabIndex={-1}` para que el foco viaje de verdad. Existen desde
   `09ecce7`, o sea que la afirmación «cero resultados» ya era falsa en la
   propia base del documento viejo.

2. **La rama de cuerpo ilegible de `downloadBlob` se rehízo.** #195 y #198
   reescribieron esa ruta: el default «No se pudo generar el PDF.» ya no existe
   en `frontend/src/services/api.ts`, ahora comparte `GENERIC_FAILURE`, y
   `error-message.ts` trata esa cadena de forma especial para que nunca le gane
   al fallback del llamador. El `catch` de parseo además re-lanza el
   `AbortError` propio en vez de tragarlo. **Resto abierto, si querés
   perseguirlo:** no hay test específico de `downloadBlob` contra un cuerpo de
   error no-JSON.

3. **`backend/app/presentacion/routers/ranking_router.py` no existe.** Lo borró
   `8354ac4` (#165), *antes* de la base que el documento viejo declaraba. Dos
   ítems lo citaban. Ambos quedaron corregidos arriba.

---

## Recomendación de orden

El overlay de producción (TLS con Caddy, límites de memoria y rotación de
logs) ya cerró en `feat/ingress-tls-caddy`. Quedan dos bloqueantes, y siguen
siendo **un solo frente de infraestructura**: el example de variables y el
arranque de métricas viven los dos en el borde de despliegue.

Después de los bloqueantes, **el bloque naranja antes que el amarillo**. Los
medios y menores son deuda técnica: cuestan en cada cambio futuro, pero nadie
los ve. Los hallazgos de la prueba a mano son lo que un socio abre el primer
día, y salieron de vos usando el sistema, no de un `rg`.

Dentro del naranja, mi orden:

1. **`ManagedStudentPicker`** — dos líneas, y es lo primero que toca un
   representante con dos hijos.
2. **Los seis `BackLink` viejos** — mecánico, y su candado es gratis: borrás el
   componente viejo y ya no se puede importar.
3. **Tomar lista sin pantalla de confirmación** — el más grande. Cambia el
   flujo, no la pintura. Va solo, en su propio PR.
4. **Los dos dashboards** (entrenador y alumno), cada uno con sus `cata-*` en
   la misma pasada.
5. El resto del naranja, que primero hay que re-derivar.

Y decidí lo del issue **#111**: si la app queda expuesta a internet sin límite
de intentos de login, eso deja de ser un `enhancement`.
