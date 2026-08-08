# Pendientes — índice de candados — Cata Club

- **Fecha:** 8 de agosto de 2026
- **Verificado contra:** `main` en `b475881`
- **Re-derivado después, en cuatro tandas:**
  - El ítem del conteo del panel, contra `ad57c31` (PR #150, que cerró la mitad
    de backend) y el cableado de frontend de #152.
  - Contra `fa13172` (6 de agosto): los seis ítems nuevos que abre este PR, y el
    ítem de los errores en inglés, que pasó a cerrados porque #153 y #155 lo
    resolvieron entero y le dejaron su candado.
  - Contra `930a5c5` (7 de agosto): los dos follow-ups que dejó la revisión del
    PR #160 y que hasta ahora vivían solo en el cuerpo de ese PR — el fallo de
    red que el carnet imprime igual que «sin horario asignado», y la franja que
    `/student/payments` dejó de mostrar.
  - Contra `b475881` (8 de agosto): doce cierres de la tanda de trabajo
    #163–#185 (eco de los listados, ranking/nivel, colapso del descuento,
    `rango_edad`, la fuga de `localStorage` en CI, la doble conversión de la
    ficha médica, el formulario de descuentos, la regla del efectivo, la
    inscripción por mes, categoría de enum a tabla (M1), los seis componentes
    del sistema visual y el carnet como identidad del perfil); siete ítems
    nuevos que un relevamiento proponía y que sí reprodujeron contra el
    código (`categoria_horario`, `Pago` sin registrador de efectivo, la deuda
    del colapso del descuento, cuatro colisiones de nombres, 31 migraciones
    con tres merges de heads, el `afterEach` de `test-setup.ts`, el mock de
    `next/image` duplicado); un ítem agrupado de ocho pantallas sin el
    sistema visual nuevo; y un octavo ítem propuesto —tres specs E2E
    dependientes del día real, fallando todos los lunes— que **no entró**
    porque no reprodujo: los dos specs de `trainer-attendance` que se citaban
    ya fijan el reloj (`page.clock.setFixedTime`) desde antes de esta sesión,
    con comentario propio documentando el bug de lunes y su fix; el método
    completo, más esta clase de discrepancias, vive en
    `docs/como-trabajamos.md`.

  **El resto de la lista no se re-verificó** en esta tanda y sigue apoyado en
  `930a5c5`: vale el punto 1 de abajo, es hipótesis hasta re-derivarlo.
- **Propósito:** una sola lista de lo que sigue abierto, con su evidencia, el
  comando que la reproduce y el test que lo cerraría; y una sola tabla de lo
  cerrado, cada fila sostenida por un candado ejecutable. Cómo se llegó a
  estos cierres —el método, no los defectos— está en
  [`docs/como-trabajamos.md`](./como-trabajamos.md).

Este documento ya mintió tres veces: dos que él mismo documentaba, y una
tercera detectada el 5 de agosto — nueve ítems figuraban abiertos estando
resueltos en el código, incluido el que se describía como «el único defecto
abierto con consecuencia de dinero». La tercera vez llegó a contradecirse
consigo mismo: la actualización parcial de #145 cerró el healthcheck en el
cuerpo (línea 237) mientras el resumen al pie lo seguía llamando «agujero de
operación» (línea 365) y el encabezado declaraba una base de cuatro commits
atrás. Las tres veces la causa fue la misma: afirmaciones sin comando que las
re-derive, y más de un lugar afirmando lo mismo. Por eso el formato cambió.

## Cómo se re-deriva este documento

Un documento que no explica cómo re-verificarse vuelve a podrirse en silencio.
El procedimiento completo:

1. **Fijar la base.** `git fetch origin && git rev-parse origin/main`. Si el
   sha no es `b475881`, todo lo de abajo es hipótesis hasta re-derivarlo.
2. **Cada ítem abierto** lleva su comando en «Cómo se verificó». Correrlo desde
   la raíz del repo. Si ya no reproduce la evidencia, el ítem cambió: se
   actualiza acá, en el mismo PR que el cambio de código o en uno de docs
   inmediato.
3. **Cada ítem cerrado** lleva el test que lo sostiene. Frontend:
   `cd frontend && npx vitest run <archivo>`. Backend:
   `cd backend && pytest "<archivo>::<test>"` (requiere `TEST_DATABASE_URL`;
   ver `backend/tests/conftest.py`). Si el test no existe o no pasa, el ítem
   **no está cerrado**: vuelve a la lista de abiertos con «falta su candado».
4. **Un ítem nuevo** entra solo con los cuatro campos completos: qué está mal,
   dónde (`archivo:línea`), cómo se verificó (el comando exacto), y qué test lo
   cerraría. Sin los cuatro, no entra.
5. Los tests de frontend citados abajo se corrieron el 5 de agosto de 2026
   sobre `71736d4`; entre `71736d4` y `51a6de9` no cambió ningún archivo de
   `frontend/` (`git diff --stat 71736d4..51a6de9`), así que esos resultados
   valían para la base de esa tanda. **Ya no valen para `b475881`**: entre
   `51a6de9` y `b475881` sí cambió `frontend/` (PRs #163–#185). Cada candado
   citado en la tabla de Cerrados a partir de esta tanda lleva su propia
   corrida, no esta nota.

La severidad indica **consecuencia**, no esfuerzo:

| Severidad | Significado |
|---|---|
| **Bloqueante** | Produce datos incorrectos con consecuencia de dinero o de estado, o incumplimiento verificable |
| **Alta** | Muestra datos incorrectos al usuario, o falla en producción sin que nadie se entere |
| **Media** | Deuda que encarece cada cambio futuro |
| **Baja** | Correcto pero mejorable; sin consecuencia observable |

---

## Abiertos

### Datos incorrectos

- [ ] **El mensaje del 408 no puede salir nunca, y en su lugar el usuario lee
  que la operación «se canceló».** (Alta)
  - **Qué está mal:** `STATUS_MESSAGES` promete «La operación tardó demasiado.
    Intente nuevamente.» para un 408 que nada en esta pila produce: no hay un
    solo `408` en `backend/app` ni en el resto de `frontend/src`, y el
    despliegue no tiene ingress ni proxy inverso que pudiera emitirlo. Lo que
    sí ocurre cuando el servidor se demora es que el cliente aborta por su
    cuenta a los 10 s (`DEFAULT_TIMEOUT_MS`, el `setTimeout` que llama a
    `controller.abort()`); `request` tiene `try/finally` pero no `catch`, así
    que el `AbortError` sube intacto hasta el traductor, que lo mapea a «La
    operación se canceló.». El usuario lee que algo se canceló —como si hubiera
    navegado, cerrado el formulario o pedido otra cosa— cuando lo que pasó es
    que el servidor no contestó a tiempo.
    Va en Alta y no en deuda por lo que es: un mensaje **falso** al usuario, la
    clase exacta de defecto que el traductor vino a eliminar. Que además sea
    código muerto es la mitad menor del problema.
  - **Dónde:** `frontend/src/lib/error-message.ts:162` (la promesa
    inalcanzable); `frontend/src/services/api.ts:207`
    (`DEFAULT_TIMEOUT_MS = 10_000`), `:299` (el `setTimeout` que aborta),
    `:311-365` (el `try/finally` sin `catch`);
    `frontend/src/lib/error-message.ts:224` (el mapeo a «se canceló»).
  - **Cómo se verificó:** `rg -n '\b408\b' backend/app frontend/src` → un único
    resultado, la propia fila de `STATUS_MESSAGES`;
    `rg -ln 'caddy|nginx|traefik' --glob '!**/node_modules/**' --glob '!**/*.lock' .`
    → solo este documento, ningún proxy en la pila que pudiera emitirlo.
  - **Qué test lo cerraría:** dos, y son distintos. El de comportamiento: un
    request que se pasa del timeout llega al traductor como «tardó demasiado» y
    no como «se canceló» —exige antes separar el abort por timeout del abort del
    llamador, que hoy comparten el mismo `AbortController`—. Y el guardián: toda
    clave de `STATUS_MESSAGES` es un status que algún camino de esta pila puede
    devolver, rojo si se agrega otra promesa inalcanzable.

- [ ] **Un fallo de red al consultar el horario se imprime en el carnet igual
  que «el club no le asignó horario».** (Alta)
  - **Qué está mal:** el carnet emite la fila «Franja» bajo una única
    condición —`horariosState.status === "ready"`— y `describeAssignedWindows`
    devuelve `null` cuando el alumno no tiene filas `alumno_horario`. Tres
    estados distintos colapsan así en el mismo carnet sin fila: la petición en
    vuelo, la petición que falló, y el alumno al que efectivamente nadie le
    asignó horario. La ausencia de esa fila no es neutra: el docstring de
    `describeAssignedWindows` la define como el signo de que el club no asignó
    horario («the carnet then omits the fact instead of showing a band nobody
    committed to»). Ante un fallo de red ese signo afirma algo falso, y las dos
    acciones que habilita son opuestas: recargar la página contra ir a
    preguntar en administración.
  - **Lo que lo atenúa, y por qué igual va en Alta:** el panel «Próximos
    entrenamientos» se renderiza en la misma pantalla, con el mismo
    `horariosState`, y sí distingue los tres estados (`page.tsx:346` para
    `loading`, `:352` para `error`), así que quien lea la pantalla completa ve
    el fallo. Pero el carnet es la parte que se imprime y se saca de captura:
    leído solo —que es exactamente para lo que existe— sigue afirmando el
    hecho falso.
  - **Dónde:** `frontend/src/app/student/page.tsx:120-122` (la única rama que
    emite la fila); `frontend/src/app/student/student-utils.ts:439` (el
    `return null` sin horarios asignados); `frontend/src/app/student/page.tsx:550`
    (el `catch` que fija `status: "error"`).
  - **Cómo se verificó:**
    `rg -n 'horariosState.status === "ready" \? describeAssignedWindows|windows\.size === 0\) return null' frontend/src/app/student/page.tsx frontend/src/app/student/student-utils.ts`
    → dos resultados, y son toda la lógica que decide la fila: una sola rama la
    produce, y la función devuelve `null` cuando no hay ventanas. Ni `error` ni
    `loading` tienen rama propia en el carnet.
  - **Qué test lo cerraría:** en `frontend/src/app/student/__tests__/StudentPage.test.tsx`,
    uno que monte la pantalla con la consulta de horarios fallando y le exija al
    carnet un texto que NO aparezca cuando esa misma consulta responde con cero
    asignaciones. Hoy sale rojo: los dos escenarios renderizan un carnet
    idéntico.

### Deuda (Media)

- [ ] **`GENERIC_FAILURE` atraviesa las dos compuertas y le gana al fallback del
  llamador.**
  - **Qué está mal:** «No se pudo completar la operación.» no dispara ningún
    patrón de `IMPLEMENTATION_VOCABULARY` y mide bastante menos de 200
    caracteres, así que `isUserFacingText` la aprueba. El cliente la pone como
    `message` de todo `ApiClientError` cuyo cuerpo no matchee `isApiErrorBody`;
    si ese status es 400, 409 o 422, la compuerta 1 también pasa y
    `toUserMessage` devuelve el genérico del cliente en lugar del fallback del
    llamador, que sí nombra la operación («No se pudo guardar el descuento.»).
    El módulo exige evidencia positiva de que el texto se escribió para una
    persona. Este texto la tiene, pero no la escribió el backend: la escribió el
    propio cliente para cuando no hay nada que decir.
  - **Latente, no vivo:** hoy no se encontró una ruta BFF que devuelva 400, 409
    o 422 con un cuerpo que `isApiErrorBody` rechace —`passthroughBackendError`
    normaliza todo a `{ message: <string> }`, incluido el `detail` de lista de un
    422 de FastAPI—. La compuerta falla abierta; el costo lo paga quien agregue
    la próxima ruta con otra forma de error.
  - **Ojo con la cita:** el relevamiento que originó este ítem lo apoyaba en
    `error-message.ts:62` («It is not wired up yet.»). Esa línea dice otra cosa
    —habla del cableado del módulo, no de la compuerta— y además hoy es falsa
    (ver el ítem siguiente). El defecto se sostiene igual, por lectura del
    código, no por esa cita.
  - **Dónde:** `frontend/src/lib/error-message.ts:186` (la constante),
    `:141-145` (la compuerta 2), `:239-242` (la compuerta 1 y el retorno del
    `detail`); `frontend/src/services/api.ts:340` (dónde se pone), `:747-752`
    (`isApiErrorBody`, que exige `detail`/`message` string no vacío). Un segundo
    genérico de la misma familia vive fuera del traductor en `:924`
    («No se pudo generar el PDF.»).
  - **Cómo se verificó:**
    `rg -n 'GENERIC_FAILURE|isApiErrorBody|INPUT_STATUSES' frontend/src/lib/error-message.ts frontend/src/services/api.ts`
    (mostrar la constante y las dos compuertas) y
    `rg -n 'GENERIC_FAILURE' frontend/src/lib/__tests__/` → cero: ningún test del
    traductor pasa la constante por la compuerta.
  - **Qué test lo cerraría:** uno que afirme `isUserFacingText(GENERIC_FAILURE)
    === false`; o, mejor porque ataca la causa, que `toUserMessage` con un
    `ApiClientError(GENERIC_FAILURE, 409)` devuelva el fallback del llamador.

- [ ] **El encabezado de `error-message.ts` afirma «It is not wired up yet» y
  hace dos PRs que dejó de ser cierto.**
  - **Qué está mal:** el comentario del módulo declara que solo `GENERIC_FAILURE`
    está vivo y que «los 28 sitios de render pasan a `toUserMessage` en el
    follow-up». Ese follow-up ya ocurrió, en #153 y #155: hoy hay 30 llamadas a
    `toUserMessage` en 17 archivos y **cero** lecturas crudas de `err.message` en
    `.tsx`. Es la misma clase de afirmación que este documento pagó tres veces
    —estado escrito en prosa, sin comando que lo re-derive, envejeciendo en
    silencio— solo que dentro de un comentario. Y ya cobró: el relevamiento que
    abrió este PR la citó como evidencia de otra cosa.
  - **Dónde:** `frontend/src/lib/error-message.ts:62-64`.
  - **Cómo se verificó:**
    `rg -c 'toUserMessage\(' --glob '!**/__tests__/**' --glob '!**/error-message.ts' frontend/src`
    → 17 archivos, 30 llamadas sumadas;
    `rg -n 'err(or)?\.message' --glob '*.tsx' --glob '!**/__tests__/**' frontend/src`
    → sin resultados.
  - **Qué test lo cerraría:** ninguno razonable, y conviene decirlo en vez de
    inventar un campo. Es prosa dentro de un comentario; no hay candado barato
    para el tiempo verbal de una oración. El cierre es borrar el párrafo: el
    guardián `error-message-usage.test.ts` ya afirma el estado que el comentario
    niega. Se anota igual porque un comentario que miente cuesta lo mismo que un
    documento que miente.

- [ ] **`downloadBlob` no tiene timeout ni cancelación, y el encabezado del
  cliente promete que sí.**
  - **Qué está mal:** la cabecera del módulo declara que «every request aborts
    after 10 seconds by default». `downloadBlob` no pasa por `request`: llama a
    `fetch(endpoint)` pelado, sin `signal` y sin `setTimeout`. El BFF que proxea
    tampoco pone uno. Y es justo el camino más lento del producto, la generación
    de PDF: un backend colgado deja la pestaña esperando sin error, sin cancelar
    y sin límite, la bandera de pending de la pantalla nunca se apaga, y al
    usuario no le queda más salida que recargar. No muestra un dato incorrecto
    —por eso Media y no Alta—, pero es una operación sin cota que además
    contradice por escrito la garantía del propio módulo.
  - **Dónde:** `frontend/src/services/api.ts:15-17` (la promesa), `:918-919` (el
    `fetch` sin `signal`);
    `frontend/src/lib/server/backend-client.ts:167-174` (`proxyBackendPdfGet`,
    sin timeout propio); el consumidor que se queda colgado,
    `frontend/src/app/reports/page.tsx:308`.
  - **Cómo se verificó:**
    `rg -n 'signal|Timeout|TIMEOUT' frontend/src/lib/server/backend-client.ts`
    → sin resultados; `rg -n 'fetch\(' frontend/src/services/api.ts` → tres
    llamadas, y la de `:919` es la única sin `signal`.
  - **Qué test lo cerraría:** uno con temporizadores falsos que afirme que
    `downloadBlob` aborta pasado su timeout y que el error llega tipado. El
    precedente de cómo elegir el número está en `CHATBOT_TIMEOUT_MS`
    (`api.ts:1638-1647`), que resolvió el caso simétrico decidiendo a propósito
    quién aborta primero, el cliente o el BFF.

- [ ] **Dos sistemas de tokens de color conviven: `cata-*` y La Paleta.**
  - **Qué está mal:** 449 usos de tokens `cata-*` en posición de clase, en 37
    archivos; 20 archivos mezclan ambos sistemas en el mismo componente,
    incluidos `Button` (su variante `primary` entera es `cata-*`) y
    `AppShell`. Ningún guardián lo frena: `color-contrast.test.ts` vigila hex
    crudos y colores Tailwind con nombre, pero `cata-*` es un token legítimo
    y pasa limpio, así que la mezcla puede crecer.
  - **Dónde:** `frontend/src/components/ui/Button.tsx:43`;
    `frontend/src/components/shell/AppShell.tsx:489,596,605,708,906,911,935`.
  - **Cómo se verificó:**
    `rg -o '\b(?:bg|text|border|ring|from|via|to|divide|fill|stroke|hover:bg|hover:border|hover:text)-cata-[a-z0-9-]+' frontend/src --glob '!**/__tests__/**' | wc -l` → 449;
    intersección de archivos con `cata-*` y con
    `\b(bg|text|border|ring|fill|stroke)-(ball|coal|paper|sunken|canvas)\b` → 20.
  - **Qué test lo cerraría:** un presupuesto que solo baja, con el patrón
    `RAW_PALETTE_DEBT` que ya usa `color-contrast.test.ts:593`: lista
    congelada de archivos con `cata-*`, roja si aparece uno nuevo o si un
    archivo saneado recae.

- [ ] **`GET /ranking/notificaciones/mias` devuelve `List[...]` sin paginar.**
  - **Qué está mal:** las notificaciones crecen monótonamente por usuario y el
    endpoint las devuelve enteras, sin `skip`/`limit`. A diferencia de los
    catálogos, acá no hay comentario que lo justifique como deliberado, porque
    no lo es.
  - **Dónde:** `backend/app/presentacion/routers/ranking_router.py:134-146`.
  - **Cómo se verificó:**
    `rg -n "notificaciones/mias" -A 12 backend/app/presentacion/routers/ranking_router.py`
    — sin parámetros de paginación, sin `PaginatedResponse`.
  - **Qué test lo cerraría:** los cuatro del patrón ya establecido en
    `backend/tests/test_paginacion_listados.py` (envelope, tope de `limit`,
    paginación sin solape con orden estable), aplicados a esta ruta.

- [ ] **Rutas BFF duplicadas en dos idiomas.**
  - **Qué está mal:** conviven tres pares espejo — `attendance`/`asistencias`,
    `payments`/`membresias`, `members`/`personas` — entre 16 directorios de
    API. Es una de las costuras que ya produjo defectos reales.
  - **Dónde:** `frontend/src/app/api/` (los seis directorios de los pares).
  - **Cómo se verificó:** `fd -t d . frontend/src/app/api --max-depth 1`.
  - **Qué test lo cerraría:** tras consolidar, un inventario de rutas que
    afirme un solo directorio por dominio y se ponga rojo si reaparece un
    espejo.

- [ ] **La interfaz de fichas médicas sigue restringida a administradores.**
  - **Qué está mal:** la API ya autoriza al representante a leer y actualizar
    la ficha de su representado, con tests de aislamiento entre familias; la
    UI no acompañó. `MedicalRecordEditor` existe solo bajo `members/`, área de
    administración, y ninguna ruta de `app/student/**` lo importa.
  - **Dónde:** `frontend/src/app/members/MedicalRecordEditor.tsx`; su único
    consumidor es `frontend/src/app/members/page.tsx`.
  - **Cómo se verificó:** `rg -ln 'MedicalRecordEditor' frontend/src` — dos
    archivos, ambos bajo `members/`, más su test unitario.
  - **Qué test lo cerraría:** el de la vista del representante que renderiza
    el editor para su representado y niega el ajeno.

- [ ] **Sin métricas ni trazas.**
  - **Qué está mal:** la correlación se cerró en #144 (`X-Request-ID` en toda
    respuesta, disponible en `request.state`), pero las otras dos patas de
    observabilidad no existen: ni métricas ni trazas distribuidas. Son ahora
    incrementales sobre el `request_id`.
  - **Dónde:** `backend/main.py:141-165` (lo que ya hay; no hay dónde anclar
    lo que falta).
  - **Cómo se verificó:**
    `rg -ln "prometheus|opentelemetry|statsd" backend/` → vacío.
  - **Qué test lo cerraría:** el que traiga el cierre (p. ej. `/metrics`
    responde y expone contadores por ruta); no se puede candar lo que aún no
    se diseñó.

- [ ] **`docker-compose.prod.yml` no completa el contrato de operación.**
  - **Qué está mal:** sin ingress/TLS, sin límites de recursos y sin rotación
    de logs. El propio archivo lo declara pendiente.
  - **Dónde:** `docker-compose.prod.yml:11-14` (el comentario que difiere
    Caddy, límites y logging a una continuación); el archivo completo son 50
    líneas de overrides de entorno.
  - **Cómo se verificó:**
    `rg -n "logging:|max-size|deploy:|mem_limit|caddy|traefik|nginx" docker-compose*.yml`
    — solo dos comentarios.
  - **Qué test lo cerraría:** extender
    `backend/tests/test_docker_compose_config.py` (hoy solo garantiza
    `CORS_ORIGENES`) con asserts de límites de memoria y `logging` por
    servicio; el ingress se canda en CI levantando el stack completo.

- [ ] **`.env.example` incompletos.** (**Bloqueado:** los permisos del
  repositorio impiden editar `.env*`.)
  - **Qué está mal:** el `./.env.example` raíz —el que lee docker-compose— no
    documenta `IMAGE_TAG` (consumido en `docker-compose.yml:79,136,170,221`),
    `FRONTEND_URL` (`:112`) ni los seis `SMTP_*` (`:106-111`).
    `RESET_HOSTS_PERMITIDOS` (definido en
    `backend/app/soporte_transversal/configuracion.py:447-449`) y
    `TEST_DATABASE_URL` (obligatorio para la suite,
    `backend/tests/conftest.py:53-58`) no figuran en **ningún** example.
    Ojo: `backend/.env.example` sí trae `FRONTEND_URL` y los `SMTP_*` — la
    versión anterior de este ítem los daba por ausentes en todas partes.
  - **Dónde:** `./.env.example` (25 líneas), `backend/.env.example` (58),
    `frontend/.env.local.example` (44).
  - **Cómo se verificó:**
    `rg -n "RESET_HOSTS_PERMITIDOS|TEST_DATABASE_URL|IMAGE_TAG|FRONTEND_URL|SMTP_" .env.example backend/.env.example frontend/.env.local.example`
  - **Qué test lo cerraría:** uno de paridad example-vs-`configuracion.py`:
    toda variable consumida por compose o settings figura en el example que
    corresponde.

- [ ] **`categoria_horario` promete más de lo que entrega: el enum `Categoria`
  sigue atando el sistema a cinco valores en otros dos lugares.**
  - **Qué está mal:** el docstring de `CategoriaHorario` dice que la categoría
    «se movió a tabla para que el club pueda sumar una categoría nueva sin un
    deploy de código», y es cierto para horas/días. No lo es para filtrar ni
    para mostrar: el filtro de listado sigue tipado contra el enum Python
    `Categoria`, así que FastAPI rechaza con 422 cualquier código que no sea
    uno de los cinco ya conocidos; y `categoria_en_castellano` hace
    `_CATEGORIAS[Categoria(categoria)]`, que **lanza** `ValueError` —no
    devuelve un genérico— para un código fuera del enum. Una categoría nueva
    sembrada solo en `categoria_horario` no sería filtrable por el listado ni
    tendría nombre para mostrar; reventaría con un error, no con un dato
    incompleto.
  - **Dónde:** `backend/app/presentacion/routers/asistencias_router.py:83`
    (`categoria: Optional[Categoria] = Query(default=None)`);
    `backend/app/dominio/etiquetas.py:50-56,71-72` (`_CATEGORIAS` y
    `categoria_en_castellano`); el docstring que promete lo contrario en
    `backend/app/dominio/modelos.py:461-463` (`CategoriaHorario`).
  - **Cómo se verificó:**
    `rg -n "categoria: Optional\[Categoria\]" backend/app/presentacion/routers/asistencias_router.py`
    → línea 83; `rg -n "_CATEGORIAS: dict\[Categoria, str\]|def categoria_en_castellano" backend/app/dominio/etiquetas.py`
    → líneas 50 y 71-72, con `Categoria(categoria)` sin `try` alrededor.
  - **Qué test lo cerraría:** uno de backend que siembre una sexta fila en
    `categoria_horario` con un código fuera del enum `Categoria` y afirme dos
    cosas hoy falsas: que `GET /asistencias/horarios?categoria=<nueva>` no
    responde 422, y que `categoria_en_castellano("<nueva>")` devuelve un
    nombre en vez de lanzar.

- [ ] **La regla «solo el socio registra efectivo» no tiene red en la base:
  `Pago` no registra quién lo creó.**
  - **Qué está mal:** la regla de #175 (`membresia_pago_servicio.py:252-260`,
    «un pago EFECTIVO es la declaración de quien entregó el dinero») vive
    solo en el servicio. `Pago` no tiene una columna de quién lo registró
    —`persona_id` es el titular al que se le imputa el pago, no quien lo
    escribió—, así que no hay forma de reconstruir después, desde la base,
    quién declaró un efectivo, ni de respaldar la regla con un `CHECK` o una
    auditoría si un INSERT la esquivara. Incremental respecto de la regla ya
    en el servicio: el patrón que este documento ya aplicó para invariantes
    financieras (índices y `CHECK` como red bajo el chequeo del servicio,
    ver `ck_pago_descuento_valor_congelado` más abajo) no existe acá.
  - **Dónde:** `backend/app/dominio/modelos.py:357-373` (`Pago`, sin columna
    de creador); la regla que quedaría sin red,
    `backend/app/servicios_negocio/membresia_pago_servicio.py:252-260`.
  - **Cómo se verificó:**
    `rg -n "class Pago" -A 50 backend/app/dominio/modelos.py | rg "Mapped"`
    → ninguna columna de tipo `registrado_por`/`creado_por_persona_id`.
  - **Qué test lo cerraría:** ninguno hoy —no hay dato que auditar—; si la
    regla importa lo suficiente para respaldarla en la base, el cierre es
    agregar la columna y un test de integración que la haga NOT NULL en el
    camino de EFECTIVO.

- [ ] **Deuda del colapso del descuento (#166): tres huecos que la migración y
  el modelo dejaron abiertos.**
  - **Qué está mal, en tres partes:**
    1. El backfill de `ade8e3c117ca` asume «un pago tiene a lo sumo una fila
       en `descuento_aplicado`» apoyado solo en el docstring de la migración
       («ya verificado contra la base sembrada»); no hay un test que reproduzca
       un `Pago` con dos `DescuentoAplicado` y afirme qué hace el backfill con
       él (hoy sería no determinístico, y la migración lo dice, pero nada lo
       ejercita).
    2. `descuento_autorizado_por_persona_id` quedó `Mapped[Optional[int]]`
       (nullable) en `Pago`, cuando el `autorizado_por_persona_id` de la
       `DescuentoAplicado` que reemplazó era `Mapped[int]` (`NOT NULL`): la
       migración aflojó una restricción que existía, sin que conste si fue
       deliberado.
    3. El `CHECK ck_pago_descuento_valor_congelado` es asimétrico: cubre
       «hay `descuento_id` sin `descuento_valor_aplicado`» pero no el inverso
       —un INSERT con `descuento_valor_aplicado` puesto y `descuento_id` en
       `NULL` pasa el `CHECK` igual.
  - **Dónde:**
    `backend/alembic/versions/ade8e3c117ca_congelar_descuento_en_columnas_de_pago.py:7-10,59-64`
    (el docstring y el comentario del backfill);
    `backend/app/dominio/modelos.py:401-403` (la columna nullable) contra
    `git show df13b8a -- backend/app/dominio/modelos.py` línea 173 del diff
    (`autorizado_por_persona_id: Mapped[int]`, la que se reemplazó);
    `backend/app/dominio/modelos.py:351-354` (el `CHECK`).
  - **Cómo se verificó:** lectura directa de la migración y del modelo;
    `rg -n "descuento_autorizado_por_persona_id: Mapped" backend/app/dominio/modelos.py`
    → `Optional[int]`; `git show df13b8a -- backend/app/dominio/modelos.py | rg "autorizado_por_persona_id: Mapped"`
    → el `Mapped[int]` que se borró; `rg -ln "descuento_aplicado" backend/tests/`
    → ningún test de migración con más de una fila por pago.
  - **Qué test lo cerraría:** tres, uno por punto: (1) un test de migración
    que siembre un `Pago` con dos `descuento_aplicado` antes de
    `ade8e3c117ca` y afirme el comportamiento del backfill, documentado en
    vez de accidental; (2) la decisión registrada sobre si
    `descuento_autorizado_por_persona_id` debe ser `NOT NULL` cuando
    `descuento_id` no es nulo, con su `CHECK` si la respuesta es sí; (3) un
    `CHECK` simétrico o un test que afirme por qué no hace falta.

- [ ] **Cuatro colisiones de nombres que ya mordieron o pueden morder.**
  - **Qué está mal, las cuatro:**
    1. `TipoMembresia.categoria` (`String(80)` de texto libre, «categoría
       comercial») contra `HorarioEntrenamiento.categoria` (FK a
       `categoria_horario.codigo`, la fuente real de horarios). Esta ya
       produjo un defecto real: el propio docstring de `TipoMembresia` lo
       documenta —declaraba «20:00-21:00» para Adultos cuando el horario real
       termina a las 21:15— y es la razón por la que #160 eliminó
       `franja_horaria`.
    2. `ServicioNotificaciones` (`backend/app/infraestructura/notificaciones_servicio.py:41`,
       adaptador SMTP de infraestructura) contra `NotificacionServicio`
       (`backend/app/servicios_negocio/notificacion_servicio.py:18`, el feed
       de notificaciones in-app, capa de negocio). Nombres casi idénticos para
       capas y responsabilidades opuestas.
    3. `MembershipStatus` (`frontend/src/services/api.ts:49`, `"activa" |
       "vencida" | "suspendida"`) duplica bajo otro nombre a `EstadoMembresia`
       (`frontend/src/types/domain.ts:94`, los mismos tres valores) —el propio
       comentario de `api.ts:46` dice «aligns with `EstadoMembresia`», o sea
       que la sincronía es manual, no un alias de TypeScript—. Y `"suspendida"`
       es rama muerta en ambos: el enum de backend
       (`backend/app/dominio/enums.py:29-31`) solo tiene `INACTIVA`, `ACTIVA`,
       `VENCIDA` —nunca `SUSPENDIDA`— y el único punto de traducción,
       `MEMBERSHIP_STATUS_BY_ESTADO`
       (`frontend/src/lib/membership-status.ts:14-18`), jamás produce
       `"suspendida"`, aunque `members-utils.ts:355` la lee como si pudiera
       ocurrir.
    4. `STAT_GRID` (`frontend/src/components/ui/StatCard.tsx:36`, una cadena
       de clases CSS) contra `StatGrid` (`frontend/src/components/ui/StatGrid.tsx:44`,
       un componente React) — las dos se exportan desde el mismo barrel,
       `frontend/src/components/ui/index.ts:56,61`.
  - **Cómo se verificó:** lectura directa de cada docstring y definición
    citada arriba; `rg -n "class ServicioNotificaciones|class NotificacionServicio" backend/app`;
    `rg -n "type EstadoMembresia" frontend/src` → un único resultado (no está
    duplicado bajo el mismo nombre, ver nota abajo);
    `rg -n "STAT_GRID|export.*StatGrid" frontend/src/components/ui/*.ts frontend/src/components/ui/*.tsx frontend/src/components/ui/index.ts`.
  - **Ojo con el enunciado de la colisión 3:** no es que `EstadoMembresia` esté
    definido dos veces bajo el mismo nombre —hay un solo
    `export type EstadoMembresia`—; es que `MembershipStatus` es una segunda
    definición, mismos valores, otro nombre, sin alias de tipo que las ate.
  - **Qué test lo cerraría:** para la 3, uno que afirme
    `MEMBERSHIP_STATUS_BY_ESTADO` nunca produce `"suspendida"` **hoy**, para
    que decidir borrarla o cablearla sea explícito y no un olvido; para las
    otras tres, ninguno barato —son de nombres, no de comportamiento—, así
    que el cierre realista es un renombre cada una, no un candado.

- [ ] **29 migraciones… en realidad 31, con tres merges de heads, no dos.**
  - **Qué está mal:** `ls backend/alembic/versions/*.py` da 31 archivos, y
    tres de ellos tienen `down_revision` tupla (dos heads fusionados en una
    migración): `a1b2c3d4e5f6` (`remover_beca` × `tipos_notificacion_pago`),
    `9a8b7c6d5e4f` (`categoria_horario` × `vencimiento_tiponotificacion`) y
    `0756dd06d542` (`alumno_horario` × `observaciones_justificativo`). Cada
    fusión es evidencia de dos ramas de trabajo que tocaron el esquema en
    paralelo sin coordinarse. No es un defecto puntual —cada migración
    individual es correcta—, es una tendencia a vigilar: planificar las
    próximas migraciones de una feature como una secuencia lineal única desde
    el diseño, no como fusiones a posteriori.
  - **Dónde:** `backend/alembic/versions/` (31 archivos);
    `a1b2c3d4e5f6_merge_beca_y_notificacion_heads.py`,
    `9a8b7c6d5e4f_merge_b7f3_y_a3b4_heads.py`,
    `0756dd06d542_merge_alumno_horario_y_observaciones_.py`.
  - **Cómo se verificó:** `ls backend/alembic/versions/*.py | wc -l` → 31;
    `rg -n "down_revision: Union\[str, Sequence\[str\], None\] = \(" backend/alembic/versions/*.py`
    → los tres archivos de merge, cada uno con dos revisiones en la tupla.
  - **Qué test lo cerraría:** ninguno razonable retroactivo. Hacia adelante,
    el hábito lo sostiene la revisión de PR, no un test; si se quiere un
    candado, uno que cuente los heads de `alembic heads` y falle si supera 1
    fuera de una ventana corta post-merge no es descabellado, pero es nuevo
    tooling, no un test existente que extender.

### Pantallas sin el sistema visual nuevo

- [ ] **Ocho pantallas todavía no aplican `DataBox`/`DataRow`/`StatGrid`/
  `MemberCard`/`BackLink` (#176-#180); 32 archivos siguen en `cata-*`.**
  - **Qué está mal:** el sistema visual nuevo tiene seis componentes con test
    propio (`DataBox`, `BackLink`, `DataRow`, `Table` extendida, `StatGrid`,
    `MemberCard`) y ya se aplicó a `/members`, `/profile` y `/groups`. Ocho
    pantallas quedan pendientes:
    1. **Dashboard de entrenador** (`frontend/src/app/trainer/page.tsx`) —
       importa `Badge, Button, EmptyState, ErrorState, LoadingState` pero
       ningún primitivo de tarjetas/grilla (`trainer/page.tsx:43`); el
       dashboard de admin ya agrupa sus métricas en `StatCard`/`STAT_GRID`
       (`frontend/src/app/dashboard/page.tsx:46-48,210`) como referencia de
       forma, aunque tampoco migró todavía al `StatGrid` nuevo.
    2. **Dashboard de alumno** (`frontend/src/app/student/page.tsx`) — el
       dueño pidió reducirlo a la card de membresía y accesos rápidos, no
       trasladar el resto; es un recorte de información, no una migración de
       componentes.
    3. **`/student/payments`** (`frontend/src/app/student/payments/page.tsx`).
    4. **`/student/attendance`** (`frontend/src/app/student/attendance/page.tsx`).
    5. **Preguntas frecuentes** (`frontend/src/app/ayuda/page.tsx`) — además
       importa el `BackLink` VIEJO (`@/components/BackLink`), no el nuevo de
       `ui/` («the one back control for the whole system», con test propio y
       cero consumidores hoy: `rg -ln 'from "@/components/ui/BackLink"' frontend/src`
       da vacío contra seis archivos que todavía importan el viejo).
    6. **La confirmación de asistencia** — los cuatro conteos (presentes/
       ausentes/justificados/sin revisar) se renderizan como `Badge` en un
       `flex flex-wrap`, no en `StatGrid`
       (`frontend/src/app/trainer/attendance/page.tsx:1308-1319`).
    7. **El botón de agregar horario en `/groups`** («Nuevo Horario»,
       `frontend/src/app/groups/page.tsx:721,1017`) sin auditar contra el
       sistema nuevo.
    8. **Casos borde de reportes**: de los cuatro pedidos —sin datos, un solo
       alumno, rango sin asistencias, nombres largos— dos ya tienen test
       (`frontend/src/app/reports/__tests__/ReportsPage.test.tsx:213,244`,
       estado vacío inicial y rango sin resultados) y dos no
       (`rg -n 'it\(' frontend/src/app/reports/__tests__/ReportsPage.test.tsx`
       → ningún caso de un solo alumno ni de nombre largo).
  - **Dónde:** los ocho ítems de arriba.
  - **Cómo se verificó:** lectura de cada archivo citado;
    `rg -o '\b(?:bg|text|border|ring|from|via|to|divide|fill|stroke|hover:bg|hover:border|hover:text)-cata-[a-z0-9-]+' frontend/src --glob '!**/__tests__/**' -l | wc -l`
    → 32 archivos (baja de los 37 de la última verificación, ver el ítem de
    tokens en Deuda), y sigue bajando a medida que cada pantalla de esta
    lista se convierte.
  - **Qué test lo cerraría:** uno por pantalla, siguiendo el patrón que ya
    dejaron `#176`-`#180` (`DataBox.test.tsx`, `BackLink.test.tsx`,
    `DataRow.test.tsx`, `Table.test.tsx`, `StatGrid.test.tsx`,
    `MemberCard.test.tsx`); para reportes, los dos casos borde que faltan en
    `ReportsPage.test.tsx`.

### Baja

- [ ] **El `afterEach` de `test-setup.ts` limpia TODO `localStorage`, no solo
  las claves de preferencia, y su `catch` se traga cualquier error.**
  - **Qué está mal:** el hook que #168 agregó para cortar la fuga entre tests
    (ver el cierre de la fuga de `localStorage` más abajo) hace
    `window.localStorage.clear()` — borra cualquier clave, no solo las
    `cata:pref:*` que motivaron el fix. Si algún test llega a depender de otra
    clave sobreviviendo entre pasos del mismo archivo, este `afterEach` la
    destruye igual, en silencio. Y el `catch` que lo envuelve está vacío para
    cualquier excepción, no solo la de Node 26 documentada en el comentario
    de al lado: un error real de `localStorage` en Node 20/CI —no solo la
    ausencia esperada— se tragaría igual, sin log.
  - **Dónde:** `frontend/src/test-setup.ts:30` (`window.localStorage.clear()`,
    sin filtrar por prefijo), `:31-34` (el `catch` vacío sin discriminar el
    tipo de error).
  - **Cómo se verificó:** lectura directa de `frontend/src/test-setup.ts`,
    agregado en el mismo PR que este documento cita como cierre de la fuga
    (#168, commit `71f3a53`).
  - **Qué test lo cerraría:** uno que siembre una clave fuera de `cata:pref:*`
    antes del `afterEach` y afirme que sigue viva después; y uno que fuerce un
    error de `localStorage` que NO sea el de Node 26 y afirme que se
    re-lanza en vez de tragarse.

- [ ] **El mock de `next/image` está duplicado, casi idéntico, en 19 archivos
  de test.**
  - **Qué está mal:** 19 archivos bajo `__tests__/` repiten su propio
    `vi.mock("next/image", () => ({ default: ... }))`, con variaciones
    menores (algunos tipan `alt`, otros no; algunos deshabilitan el lint de
    `@next/next/no-img-element`, otros no). Es la misma clase de duplicación
    que `test-setup.ts` ya resuelve para los matchers de `jest-dom` y el
    polyfill de `<dialog>` — candidato natural a sumarse ahí, junto al
    `afterEach` de `localStorage`.
  - **Dónde:** 19 archivos, entre ellos
    `frontend/src/app/discounts/__tests__/DiscountsPage.test.tsx:36-37`,
    `frontend/src/app/trainer/__tests__/TrainerPage.test.tsx:46-50`,
    `frontend/src/app/profile/__tests__/ProfilePage.test.tsx:39-43`.
  - **Cómo se verificó:**
    `rg -l 'vi\.mock\("next/image"' frontend/src --glob '**/__tests__/**' | wc -l`
    → 19.
  - **Qué test lo cerraría:** ninguno —es duplicación, no comportamiento
    distinto—; el cierre es moverlo a `test-setup.ts` una sola vez y borrar
    las 19 copias, con la suite completa en verde como evidencia de que
    ningún test dependía de una variación puntual del mock.

- [ ] **36 mensajes de 404 siguen nombrando la implementación; y el 422 tiene
  dos bloqueos, no uno.**
  - **Qué está mal:** el PR que sacó el vocabulario de implementación de los
    mensajes visibles se limitó a los status de entrada (400/409/422), que son
    los únicos cuyo `detail` el frontend deja pasar. Los `EntidadNoEncontrada`
    quedaron como estaban: 36 mensajes que dicen «Persona con id 47 no
    encontrada», con el identificador crudo adentro.
  - **Consecuencia hoy, ninguna — por eso Baja:** un 404 se explica solo, así
    que `toUserMessage` lo reemplaza por la frase del propio frontend
    (`STATUS_MESSAGES`) y el `detail` del backend nunca se lee. Es deuda de
    forma, no un defecto vivo. Se vuelve vivo el día que alguien remapee
    `EntidadNoEncontrada` a 400 en `_MAPA_EXCEPCIONES` — y ese día
    `backend/tests/test_vocabulario_en_mensajes_de_usuario.py` se pone rojo
    solo, porque deriva su alcance de ese mapa en vez de listar excepciones.
  - **Lo del 422 es aparte y son dos bloqueos independientes:** los cuatro
    `ValueError` de `membresia_pago_schemas.py` ya están reescritos, pero su
    texto igual no llega. Primero, FastAPI emite el 422 con `detail` ARREGLO, y
    las dos puertas del cliente exigen string (`isApiErrorBody` en
    `services/api.ts:747`, `passthroughBackendError` en
    `lib/server/backend-client.ts:130`), así que las dos caen al fallback.
    Segundo, aunque se arreglara la forma, Pydantic antepone `"Value error, "`
    al mensaje, y ese prefijo dispara solo el patrón de inglés de
    `IMPLEMENTATION_VOCABULARY`. Arreglar uno sin el otro no muestra nada.
  - **Dónde:** los 36, en `app/servicios_negocio/` (los concentran
    `asistencia_servicio.py` con 9, `membresia_pago_servicio.py` con 8 y
    `geografia_servicio.py` con 5). El doble bloqueo del 422, en los dos
    archivos citados arriba.
  - **Cómo se verificó:** el conteo sale del mismo barrido que la guarda, con
    el alcance invertido (`STATUS_DE_ENTRADA` → su complemento); da 36, todos
    404, y cero en 401/403/503. El `detail` arreglo se observó contra la app
    real: `PATCH /api/v1/membresias/pagos/1/validar` con
    `{"estado_pago": "RECHAZADO"}` devuelve
    `{'detail': [{'type': 'value_error', ..., 'msg': 'Value error, Debe indicar
    el motivo del rechazo.'}]}`. Que ese texto con prefijo no pasa la compuerta
    se verificó importando `isUserFacingText` y evaluándolo.
  - **Qué test lo cerraría:** ampliar `STATUS_DE_ENTRADA` en
    `test_vocabulario_en_mensajes_de_usuario.py` a todos los status y borrar el
    recorte — la guarda ya cubre estos 36 sitios sin tocar nada más. Para el
    422 hacen falta dos: uno de backend que fije la forma del cuerpo, y uno de
    frontend sobre el prefijo de Pydantic, que es de otro PR.

- [ ] **El patrón MIME de la compuerta 2 incluye `audio` y `video`, que son
  palabras españolas.**
  - **Qué está mal:** el comentario funda la lista cerrada de los nueve tipos
    IANA en que «`palabra/palabra` a secas no es un MIME en español», y por eso
    exige un tipo conocido antes de la barra. El argumento vale para
    `application`, `font`, `image`, `message`, `model`, `multipart` y `text`,
    que no son palabras en español. No vale para `audio` ni `video`, que se
    escriben igual: «audio/visual» o «audio/video» en una frase corriente
    disparan el patrón y esconden el `detail` tras el fallback del llamador. Es
    la misma rendija que la review cerró con `lunes/miércoles`, tapada a medias.
  - **Consecuencia hoy, ninguna — por eso Baja y no Media:** ni `backend/app` ni
    `frontend/src` contienen la palabra `audio` o `video` fuera del propio
    patrón, así que ningún mensaje del producto la dispara. El criterio del
    módulo —«cada patrón está acá porque un mensaje real lo disparó»— todavía no
    se cumple en el sentido inverso: es un hueco de forma, no un defecto vivo.
  - **Dónde:** `frontend/src/lib/error-message.ts:109` (el patrón), `:104-108`
    (el comentario que lo funda).
  - **Cómo se verificó:** `rg -n 'audio|v[ií]deo' backend/app frontend/src` → un
    único resultado, la propia línea 109.
  - **Qué test lo cerraría:** en `error-message.test.ts`, al lado del caso de
    `lunes/miércoles`: `isUserFacingText` devuelve `true` para la frase con
    `audio/visual` que se elija. Exige antes decidir el arreglo —sacar los dos
    tipos de la lista, o exigir después de la barra un subtipo IANA plausible—,
    porque el test se escribe distinto según cuál se tome.

- [ ] **La rama de cuerpo ilegible de `downloadBlob` no está cubierta.**
  - **Desmentido primero:** el relevamiento anotaba «`downloadBlob` sin test de
    error». No se sostiene. `frontend/src/services/__tests__/api.test.ts:821`
    —«downloadBlob throws a typed error on a non-2xx response»— cubre la rama de
    fallo con cuerpo JSON y afirma además que no se crea el object URL.
  - **Qué está mal, entonces:** lo que queda sin cubrir es el `catch` interno,
    el que actúa cuando el cuerpo del error no parsea como JSON —un 502 del
    proxy, HTML, cuerpo vacío— y deja en pie el default «No se pudo generar el
    PDF.». Ese default es además el segundo genérico del cliente, hermano de
    `GENERIC_FAILURE` y también fuera del traductor (ver el ítem de la
    compuerta 2, arriba).
  - **Dónde:** `frontend/src/services/api.ts:924` (el default), `:930-932` (el
    `catch` que lo deja pasar).
  - **Cómo se verificó:** `rg -n 'No se pudo generar el PDF\.' frontend/src` → un
    único resultado, `api.ts:924`, sin ninguna aparición bajo `__tests__`.
  - **Qué test lo cerraría:** el hermano del que ya existe: `downloadBlob` contra
    una respuesta 502 de cuerpo no-JSON rechaza con «No se pudo generar el PDF.»
    y con el status en el error.

- [ ] **Dos sesiones de pytest concurrentes contra un mismo Postgres
  colisionan.**
  - **Qué está mal:** la fixture de sesión ejecuta `DROP SCHEMA public
    CASCADE` sobre la única base de `TEST_DATABASE_URL`, sin discriminar por
    proceso: dos corridas solapadas se destruyen el esquema mutuamente. La
    asimetría duele: el arnés de migraciones sí discrimina por PID
    (`backend/tests/arnes_migraciones.py`, `_sufijo_de_proceso`), la suite
    principal no. No afecta a CI (un proceso y una base por job).
  - **Dónde:** `backend/tests/conftest.py:168-182` (el `DROP` en `:175`).
  - **Cómo se verificó:**
    `rg -n "DROP SCHEMA public CASCADE" backend/tests/conftest.py backend/tests/arnes_migraciones.py`
  - **Qué test lo cerraría:** ninguno puede verlo desde adentro de la suite.
    El cierre es replicar `_sufijo_de_proceso` en `esquema_migrado`; su
    candado es el test del arnés que ya afirma el nombre de base por PID,
    extendido a la suite principal.

- [ ] **Una pestaña abierta con el bundle anterior muestra datos incorrectos
  sin error visible al eliminar un campo del contrato.**
  - **Qué está mal:** inherente al modelo de despliegue del frontend; se
    resuelve al recargar. Sin anclaje puntual de código: es una propiedad del
    contrato sin versionar entre bundle y API.
  - **Dónde:** `frontend/src/services/api.ts` (el cliente no declara versión
    de contrato).
  - **Cómo se verificó:** reproducción manual en la auditoría del 27 de julio
    (hallazgo E): pestaña vieja + campo eliminado → datos incompletos sin
    error.
  - **Qué test lo cerraría:** ninguno razonable al costo de hoy. Cerrarlo es
    versionar el contrato (o aceptarlo formalmente y mover esta entrada a
    decisiones). Se queda acá para que la aceptación sea explícita.

### Cerrados sin candado — falta el test que los sostenga

La regla del documento: un cierre sin test no está cerrado. Estos cuatro
están resueltos o decididos en el código, pero nada se pone rojo si se
deshacen. El trabajo pendiente de cada uno es su candado, no el fix.

- [ ] **Los catálogos deliberadamente sin paginar no tienen quien funde la
  decisión.**
  - **Qué está mal:** `GET /ranking/niveles`, `GET /membresias/tipos` y
    `GET /personas/{id}/representados` están documentados en código como
    deliberadamente sin paginación (cardinalidad acotada por el negocio), pero
    ningún test afirma la forma `List[...]` ni la presencia del comentario:
    alguien puede paginarlos —rompiendo a los llamadores que necesitan el
    conjunto completo, `frontend/src/app/api/student/route.ts:85,96,108` y
    `backend/app/servicios_negocio/ranking_servicio.py:275,291`— sin que nada
    se queje.
  - **Dónde:** `backend/app/presentacion/routers/ranking_router.py:36-41`,
    `backend/app/presentacion/routers/membresias_pagos_router.py:62-67`,
    `backend/app/presentacion/routers/personas_router.py:305-316`.
  - **Cómo se verificó:**
    `rg -n "Deliberadamente SIN paginar" backend/app/presentacion/routers/` →
    los tres comentarios existen;
    `rg -l "test.*niveles.*sin_pagina|List\[" backend/tests/test_paginacion_listados.py` →
    ningún test cubre la exención.
  - **Qué test lo cerraría:** uno por endpoint que afirme respuesta como
    lista plana (sin envelope) — se pone rojo si alguien pagina sin pasar por
    acá.

- [ ] **El enlace de salto de `AppShell` no tiene test de comportamiento.**
  - **Qué está mal:** el enlace existe y está bien hecho (primero en el orden
    de tabulación, visible solo con `:focus-visible`, `<main>` con
    `tabIndex={-1}` para que el foco viaje de verdad), pero ningún test
    afirma que renderiza, que es el primer foco, ni que mueve el foco al
    destino. `main-landmark.test.ts` cubre la unicidad del landmark y
    `touch-target-usage.test.ts:195` sus 48 px; el comportamiento del salto,
    nadie.
  - **Dónde:** `frontend/src/components/shell/AppShell.tsx:487-492` (el
    enlace); destino `id` y `tabIndex={-1}` en `:875-876` — la versión
    anterior de este documento decía `:856`, que hoy es el comentario.
  - **Cómo se verificó:**
    `rg -n 'Saltar al contenido' frontend/src --glob '**/__tests__/**'` →
    cero resultados.
  - **Qué test lo cerraría:** en el test de `AppShell`: el primer `tab`
    enfoca el enlace, activarlo deja el foco en `#contenido-principal`.

- [ ] **La decisión de `alt=""` en los logos no tiene quien la funde.**
  - **Qué está mal:** nada; la decisión es correcta (los logos son
    decorativos: el nombre del club ya está como texto o `aria-label`
    adyacente, y nombrar la imagen lo duplicaría para el lector de pantalla).
    Pero la versión anterior de este documento ya la revirtió una vez en
    prosa, y sin test la próxima «corrección» bienintencionada pasa limpia.
  - **Dónde:** `frontend/src/app/landing/LandingPage.tsx:69,313` (la ruta
    cambió: antes se citaba bajo `components/`);
    `frontend/src/app/student/page.tsx:142-148` (con el razonamiento escrito
    en el código).
  - **Cómo se verificó:**
    `rg -n 'alt=' frontend/src/app/landing/LandingPage.tsx frontend/src/app/student/page.tsx`
  - **Qué test lo cerraría:** uno que afirme `alt=""` en los tres logos y la
    presencia del texto/`aria-label` adyacente que los vuelve redundantes.

- [ ] **Los estados de carga existen en las 21 páginas, pero nada obliga a la
  página 22.**
  - **Qué está mal:** el defecto reportado por la evaluación de usabilidad
    («ninguna acción confirma que ocurrió») no se reproduce: las 21 páginas
    que consumen `@/services/api` llevan bandera de pending. Lo que falta es
    el guardián que lo exija a las páginas futuras.
  - **Dónde:** patrón en `frontend/src/app/student/payments/page.tsx:423,861`
    y equivalentes.
  - **Cómo se verificó:**
    `for f in $(rg -ln 'from "@/services/api"' frontend/src/app --glob '*.tsx' | rg -v __tests__); do rg -q 'saving|isPending|submitting|Guardando|busy|loading' "$f" || echo "NO-PENDING: $f"; done`
    → vacío.
  - **Qué test lo cerraría:** ese mismo barrido, como test estilo
    `focus-ring-usage`: toda página que importa el cliente API declara un
    estado pendiente.

### Decisiones de negocio pendientes

Ninguna se resuelve escribiendo código; requieren definición. Cuando se tomen,
la decisión se registra y —donde aplique— se funde con un test, como se hizo
con el objetivo táctil (#97).

- [ ] **Borrado de `Persona`: ¿lógico o duro con `RESTRICT`?**
  - **Qué falta:** la decisión explícita. `Persona.activo` existe y la baja
    lógica funciona, pero nunca se decidió: simplemente no hizo falta.
  - **Dónde:** `backend/app/dominio/modelos.py:149`.
  - **Cómo se verificó:** `rg -n "activo" backend/app/dominio/modelos.py` y
    ausencia de política escrita en `docs/`.
  - **Qué lo cierra:** la decisión registrada; si es borrado lógico, un test
    que afirme que el duro está vedado.

- [ ] **Vincular una cuenta de menor ya creada a su representante.**
  - **Qué falta:** la vía. `POST /personas/{id}/representados` solo da de alta
    un representado nuevo; una menor que se autogestionó la cuenta no tiene
    vinculación posterior.
  - **Dónde:** `backend/app/presentacion/routers/personas_router.py` (la ruta
    de alta de representados).
  - **Cómo se verificó:** `rg -n "representados" backend/app/presentacion/routers/personas_router.py`
    — solo alta, ninguna vinculación de persona existente.
  - **Qué lo cierra:** la definición del flujo (¿quién aprueba?, ¿cómo se
    demuestra el vínculo?) y después su endpoint con tests de autorización.

- [ ] **La franja desapareció de `/student/payments` y no se decidió si vuelve
  derivada.**
  - **Qué falta:** la decisión, registrada fuera del cuerpo de un PR. #160
    eliminó `tipo_membresia.franja_horaria` y con ella la fila «Franja» de esa
    pantalla, con un motivo explícito: esa pantalla no tiene los horarios a
    mano, y un plan ahí es un precio. No fue un descuido — fue una decisión
    tomada que no quedó en ningún índice. Lo que sigue abierto es si la franja
    vuelve derivada de los `alumno_horario` del alumno, como en el carnet, o si
    se acepta que ese dato viva solo en `/student`.
  - **Dónde:** `frontend/src/app/student/payments/page.tsx:162-166` (el bloque
    de `facts`, del que se removió la fila).
  - **Cómo se verificó:**
    `git show 930a5c5^:frontend/src/app/student/payments/page.tsx | rg -n -i franja`
    → una coincidencia,
    `167:  if (membership?.franjaHoraria) facts.push({ label: "Franja", ... })`;
    `rg -n -i franja frontend/src/app/student/payments/page.tsx` → sin
    coincidencias. El dato estaba y dejó de estar.
  - **Qué lo cierra:** la decisión registrada. Si es «vuelve», la funde el mismo
    candado de coherencia que #160 dejó en el carnet, aplicado a esta pantalla:
    la franja que muestra `/student/payments` es la misma cadena que
    `describeAssignedWindows` produce sobre los `alumno_horario` del alumno, y
    se pone rojo el día que las dos pantallas discrepen. Si es «no vuelve», la
    cierra un test que afirme que esta pantalla no imprime franja alguna —
    rojo si alguien la repone leyéndola del plan, que es el defecto que #160
    eliminó.

- [ ] **Qué operaciones administrativas existen realmente en el negocio.**
  - **Qué falta:** revisar cada alta/baja administrativa contra el negocio
    real. Caso testigo: «Crear horario» no crea un horario (son cinco, fijos,
    derivados por categoría) — asigna un entrenador a una categoría existente.
    Candidatos con el mismo criterio: alta y baja de niveles de ranking, alta
    de tipos de membresía, alta de instituciones, y la sección Ranking
    completa.
  - **Dónde:** `docs/hallazgos-post-presentacion.md` §2 y §4.
  - **Cómo se verificó:** contra el negocio, no contra el código; es
    exactamente por eso que está en esta sección.
  - **Qué lo cierra:** la lista definitiva de operaciones reales; cada
    operación eliminada se funde con la desaparición de su ruta.

---

## Cerrados

Una fila por ítem, cada una con el candado que la sostiene. Si el candado
deja de pasar, la fila vuelve a abiertos.

Tests de frontend: `cd frontend && npx vitest run <archivo>`. Tests de
backend: `cd backend && pytest "<archivo>::<test>"`.

| Ítem | Cierre | Candado |
|---|---|---|
| El eco de los listados: la insignia de estado de pagos repetía la pestaña ya filtrada, y el hint de miembros repetía el conteo de alumnos en la misma fila | #163: la insignia por fila solo se muestra cuando la pestaña activa NO fija ya un único estado; el checkbox de lote de una fila sin revisar gana `aria-labelledby` propio con el nombre del alumno (antes compartía nombre accesible con otras filas sin revisar); guarda de regresión para el marcador punteado de `/groups` | `frontend/src/app/payments/__tests__/PaymentsPage.test.tsx` — «PaymentsPage — the status badge doesn't echo the active tab» (2 tests) y «PaymentsPage — unreviewed batch checkboxes keep distinct accessible names» · `frontend/src/app/members/__tests__/MembersPage.test.tsx` — «MembersPage — the stats row doesn't repeat the student count» · `frontend/src/app/groups/__tests__/GroupsPage.test.tsx` — el caso del marcador punteado |
| La función Ranking/Nivel, fuera del alcance del MVP, seguía viva en frontend y backend | #164 (frontend): borra pantallas, rutas BFF, adapters y el concepto de capacidad de grupo de la era mock. #165 (backend): borra router, schemas, servicio, repositorio y los modelos `Ranking`/`NivelRanking` — `Persona.ranking` incluido —, con migración `7e8032f48249` (drop de ambas tablas, downgrade reconstruye la estructura). El feed de notificaciones in-app se extrae a `notificacion_servicio.py` propio porque solo compartía módulo con ranking por historia, no por dominio; `/ranking/notificaciones/*` se mantiene a propósito para no romper al frontend dos veces. #169 limpia los últimos restos muertos de los fixtures E2E | Ninguna clase `Ranking`/`NivelRanking` queda en `backend/app/dominio/modelos.py` (`rg -n "class Ranking" backend/app/dominio/modelos.py` → vacío); `test_ranking.py`, `test_ranking_alumnos_con_nivel.py`, `test_ranking_concurrencia.py`, `LevelChip.tsx`/`.test.tsx` y `NivelLadder*` se borraron enteros junto con la función; `backend/tests/test_drift_migraciones.py::test_no_hay_drift_entre_modelos_y_migraciones` se pone rojo si las tablas reaparecen sin migración |
| Un pago llevaba su descuento en una tabla 1:N (`descuento_aplicado`) sin cardinalidad real que lo justificara | #166, dos migraciones lineales: `ade8e3c117ca` agrega cuatro columnas congeladas a `pago` y backfillea desde `descuento_aplicado`; `b8dacaddb73b` recién ahí la dropea. El picker de descuentos en el form de pago pasa de checkbox múltiple a single-select con «Sin descuento» — el backend ya rechazaba más de un `descuento_id` con 400 | `backend/tests/test_descuentos.py::test_mas_de_un_descuento_es_rechazado`, `::test_pago_con_descuento_id_pero_sin_valor_congelado_viola_el_check` · `frontend/src/app/members/__tests__/MembersPage.test.tsx` — «only allows one discount selected at a time (regression: backend rejects more than one)» |
| `CategoriaInfo.rango_edad` era copy de orientación («5 a 10 años») que el dominio trataba como si fuera una regla | #166, junto con el colapso del descuento: se elimina `rango_edad` del dominio, su espejo en frontend y el badge que lo renderizaba. `AsistenciaServicio.asignar_alumno_a_horario` nunca validó edad contra él —era decorativo—, así que borrarlo no cambia comportamiento, solo saca la tentación de tratarlo como validación | `rg -ni "rango.edad" backend frontend` (cubre `rango_edad` y `rangoEdad`) → sin resultados en ningún archivo de producción; `frontend/src/services/__tests__/categorias.test.ts` no lo ejercita más; el `CategoriaInfo` sin el campo se sostiene por tipos (`npm run type-check` rojo si reaparece) |
| CI daba rojo (`f1f1912`, `278a609`, `8354ac4`) mientras la suite local quedaba verde, por una fuga de `localStorage` entre tests | #168: dos causas compuestas. `findByTestId("payments-table")` resolvía antes de que el filtro asentara, y dos asserts de ausencia corrían contra un DOM todavía no asentado — ganaban la carrera en local, la perdían bajo el scheduler de CI. Además `usePersistentPreference` persiste el filtro de estado en `localStorage`, y nada lo reseteaba entre tests del mismo archivo: un test heredaba el filtro que dejó el anterior. Por qué no se veía en local: Node 26 expone un `localStorage` que tira sin `--localstorage-file`, y el propio `catch` del hook se lo tragaba, aislando cada test por accidente; Node 20 (el de CI) da un `localStorage` que funciona, así que la fuga era real ahí | `frontend/src/app/payments/__tests__/PaymentsPage.test.tsx` — «PaymentsPage — opens on the pending queue» y «PaymentsPage — the status badge doesn't echo the active tab» esperan primero el conteo de filas filtradas; `frontend/src/test-setup.ts` resetea `localStorage` en `afterEach` (con las dos limitaciones que quedan abiertas arriba, en Baja). Reproducido bajo Node 20 en contenedor: rojo antes, verde después |
| `actualizarFichaMedica` convertía a snake_case antes de mandarlo al BFF, que volvía a convertir y perdía `tipoSangre`/`contactoEmergencia`/`telefonoEmergencia` | #174: la conversión pasa a ocurrir una sola vez, en la ruta BFF; el cliente manda camelCase tal cual | `frontend/src/services/__tests__/api-bff-route-contract.test.ts` — «actualizarFichaMedica's five fields are accepted and translated by PATCH /api/fichas-medicas/persona/[id]» |
| El form de alta/edición de descuentos forzaba Nombre/Tipo/Valor en `sm:grid-cols-3` dentro del `PAGE_RAIL` de 340px, cortando placeholders y valores a mitad de palabra | #174: single-column siempre — el form nunca renderiza fuera del rail | `frontend/src/app/discounts/__tests__/DiscountsPage.test.tsx` — «does not cram Nombre/Tipo/Valor into a three-column grid inside the 340px rail», «gives every field the full input width, so a long name has room to render» |
| Un administrador podía registrar un pago en EFECTIVO en nombre de un tercero que no presenció la entrega | #175: solo el propio alumno o su representante pueden declarar EFECTIVO; el admin conserva TRANSFERENCIA para terceros; el form de `/members` deja de ofrecer EFECTIVO como método | `backend/tests/test_efectivo_solo_por_socio.py` (85 líneas de casos) · `frontend/src/app/members/__tests__/MembersPage.test.tsx` |
| Un alumno podía quedar inscripto en un subconjunto de los días de su categoría en vez de en el mes completo | #182: «the club enrolls by full month, never by a loose weekday» — `asignar_alumno_a_horario`/`desasignar_alumno_de_horario` pasan a abarcar TODOS los `HorarioEntrenamiento` de la categoría del alumno en una sola transacción; `eliminar_horario` gana un fix hermano para no desasignar de toda la categoría al borrar un solo día. #183 adapta `/groups` para consumir la inscripción atómica | `backend/tests/test_inscripcion_por_categoria.py` — 7 tests (`test_asignar_alumno_lo_inscribe_en_todos_los_horarios_de_la_categoria`, `test_asignar_alumno_no_deja_forma_de_quedar_en_un_subconjunto` y 5 hermanos) · `frontend/src/app/groups/__tests__/GroupsPage.test.tsx` |
| M1: la categoría de horario pasó de enum fijo a tabla, en tres pasos expand/migrate/(casi)contract | #170 (expand): crea `categoria_horario`/`categoria_horario_dia`, siembra las 5 filas, agrega `categoria_codigo` nullable en paralelo — sin cambio de comportamiento. #173 (cutover): modelo/servicio/schemas/router leen horas y días desde la tabla, no del dict `CATEGORIA_METADATA` (que se borra); la migración vuelve `categoria_codigo` NOT NULL, dropea el enum Postgres viejo y lo renombra a `categoria`; nace `GET /asistencias/categorias`. #179 (frontend): deja de hardcodear un mirror estático y lo trae vivo desde el backend, con degradación no bloqueante si falla. El enum Python `Categoria` sigue existiendo — ver el ítem abierto de arriba sobre lo que todavía le falta a este M1 | `backend/tests/test_categoria_repositorio.py` (5 tests) · `backend/tests/test_horario_categoria.py` + `test_drift_enums_postgres.py` (actualizados por el cutover) · `frontend/src/app/api/attendance/categories/__tests__/route.test.ts`, `frontend/src/services/__tests__/categorias.test.ts`, `frontend/src/app/groups/__tests__/GroupsPage.test.tsx` |
| Faltaban seis primitivos del sistema visual nuevo: `DataBox`, `BackLink`, `DataRow`, `Table` con columnas tipadas, `StatGrid`, `MemberCard` | #176 (`DataBox`, `BackLink`), #177 (`DataRow`, extensión de `Table`), #178 (`StatGrid`, `MemberCard`) — los seis, con test unitario propio desde el commit que los crea | `frontend/src/components/ui/__tests__/DataBox.test.tsx`, `BackLink.test.tsx`, `DataRow.test.tsx`, `Table.test.tsx`, `StatGrid.test.tsx`, `MemberCard.test.tsx` |
| El perfil no usaba el carnet (`MemberCard`) como bloque de identidad | #180: `/profile` adopta `MemberCard` como el bloque de identidad de la pantalla | `frontend/src/app/profile/__tests__/ProfilePage.test.tsx` (reescrito, +150 líneas) · `frontend/src/components/ui/__tests__/MemberCard.test.tsx` |
| `tipo_membresia.franja_horaria` era texto libre desincronizado del horario real | La columna se eliminó (`d1a5f8c30b72`, un `DROP COLUMN`), junto con su campo en el DTO, el seed y las 15 fábricas de test que la cargaban. La franja del carnet se deriva ahora de los `alumno_horario` del alumno vía `describeAssignedWindows` (`frontend/src/app/student/student-utils.ts:429`), que llama a la MISMA `buildWeeklyTrainingSchedule` de la que sale el listado de próximos entrenamientos — por construcción no pueden discrepar. Los rótulos de admin (`members-adapter.ts:82`, `payments-adapter.ts:147`) pasan de `"Mensual Adultos (20:00-21:00)"` a `"Mensual Adultos"`: un plan es un precio, no un horario. **Ojo con la premisa que no se sostuvo:** no existe «la categoría del alumno» en singular — en la QA real 4 de 7 alumnos están en FORMATIVO+INFANTIL+JUVENIL a la vez y 2 en ninguna, y `AsistenciaServicio.asignar_alumno_a_horario` no valida coherencia. Por eso la derivación lista ventanas distintas en vez de colapsarlas a un rango: 15:00–16:00 más 20:00–21:15 no es «de 15:00 a 21:15» | `frontend/src/app/student/__tests__/StudentPage.test.tsx` — «the carnet's franja agrees with the assigned schedule» · 4/4, de coherencia y no de existencia: lee la ventana del panel y le exige al carnet la misma cadena. Rojo antes (3/4 fallando, el carnet decía 21:00), verde después. Más `backend/tests/test_migracion_drop_franja_horaria.py` · 3/3 (upgrade con datos, downgrade real) y el drift genérico `test_drift_migraciones.py`. Corridos el 6 de agosto de 2026: 906 backend, 2564 frontend, `alembic upgrade head` desde base vacía en verde |
| Los errores al usuario salían en inglés cuando el backend peor se portaba | #153 y #155. El default del cliente pasó de `Request failed with status N` a `GENERIC_FAILURE` en español (`frontend/src/services/api.ts:340`; el inglés sobrevive solo en el comentario que documenta la historia, `:336`), y los 27 sitios que renderizaban `err.message` crudo pasaron por `toUserMessage`: hoy 30 llamadas en 17 archivos y cero lecturas crudas en `.tsx` (`rg -n 'err(or)?\.message' --glob '*.tsx' --glob '!**/__tests__/**' frontend/src` → sin resultados). Quedan tres observaciones del traductor en abiertos —el 408 inalcanzable, `GENERIC_FAILURE` cruzando la compuerta 2 y el encabezado ya falso—: son defectos del traductor nuevo, no la recaída de este ítem | `frontend/src/lib/__tests__/error-message.test.ts` · 19/19 y el guardián que pedía este ítem, `frontend/src/lib/__tests__/error-message-usage.test.ts` — «only the translator reads an error's message» · 5/5. Corridos el 6 de agosto de 2026 sobre `fa13172` |
| El panel contaba «por regularizar» a quien no tenía NINGUNA membresía, y usaba todo el padrón como denominador de «membresías activas» | Dos mitades, dos PRs. #150 (backend): el `NOT EXISTS` exige estado `ACTIVA` y filtra por rol alumno, y nace `total_alumnos` junto a `total_personas` porque son dos preguntas distintas (`backend/app/presentacion/schemas/dashboard_schemas.py:11`). Este PR (frontend): el campo se declara en las dos copias de `DashboardStats` (`frontend/src/app/api/dashboard/route.ts:23`, `frontend/src/services/api.ts:842`) y la pantalla lo lee — el `%` y el «de N» pasan a `totalAlumnos` (`frontend/src/app/dashboard/page.tsx:128,226`), la tarjeta «Miembros» se queda en `totalPersonas` porque dice «personas registradas» y son todas | `backend/tests/test_dashboard_stats.py::test_total_alumnos_es_el_denominador_y_total_personas_cuenta_a_todos` + `::test_alumno_con_membresia_vencida_cuenta_como_por_regularizar`, `::test_alumno_con_membresia_inactiva_cuenta_como_por_regularizar`, `::test_staff_sin_membresia_no_cuenta_como_por_regularizar` · `frontend/src/app/dashboard/__tests__/DashboardPage.test.tsx` — «counts active memberships against the alumnos, and Miembros against the whole padrón» · 18/18. El del contrato es de tipos, no de runtime: la route es passthrough y el campo ya viajaba, así que `frontend/src/app/api/dashboard/__tests__/route.test.ts` — «declares and carries totalAlumnos» se pone rojo bajo `cd frontend && npm run type-check` (TS2353), no bajo vitest |
| La selección de dependiente se perdía al navegar | Ya estaba en el código al corte anterior: `?alumno=` en la URL + `sessionStorage` por cuenta (`frontend/src/app/student/ManagedStudentPicker.tsx:43-150`); Pagos, Asistencia y Mi cuenta leen la misma fuente | `frontend/src/app/student/payments/__tests__/StudentPaymentsPage.test.tsx` — «the dependent selection survives navigation» y 3 hermanos · 27/27 |
| El botón Atrás destruía la lista de asistencia | Una entrada real de historial por paso (`pushState`, `trainer/attendance/page.tsx:362`), `popstate` restaura plantel con marcas (`:517-533`), borrador en `sessionStorage` y aviso `beforeunload` (`:763`) | `frontend/src/app/trainer/attendance/__tests__/TrainerAttendancePage.test.tsx` — «returns Back from step 3 to the roll call, marks intact, instead of ejecting the trainer» y hermanos · 82/82 |
| No existía deshacer | `frontend/src/lib/deferred-commit.ts` (`UNDO_WINDOW_MS = 8000`): la mutación espera, la UI avanza, «Deshacer» cancela algo que nunca ocurrió; `flush` en unmount/`pagehide`. En pagos; asistencia trae su propio deshacer de marcas | `frontend/src/lib/__tests__/deferred-commit.test.tsx` · 10/10 + `PaymentsPage.test.tsx` |
| El checklist no se adaptaba al método de pago | Las preguntas salen del pago, no de una constante: `buildApprovalChecklist` (`frontend/src/app/payments/payments-utils.ts:244-272`), tres ramas — efectivo, transferencia con y sin comprobante | `frontend/src/app/payments/__tests__/PaymentsPage.test.tsx` — «never asks a cash payment about a comprobante it does not have» · 50/50 |
| Sin acciones por lote en la cola de pagos | Barra de lote sobre pagos ya revisados uno a uno (`payments/page.tsx:879-889`); «commits, never reviews»; fallo parcial con reintento nominal (`:839-873`) | `PaymentsPage.test.tsx` — «shows the parked payments as a batch with its count and total», «reports a half-done batch by name, and keeps the failures ready to retry» |
| Regresión de vocabulario | No se reprodujo: los enums de base aparecen solo como identificadores y se renderizan vía mapas de labels | `frontend/src/lib/__tests__/ui-vocabulary.test.ts` — «leaves none in the shipped copy» · 5/5 |
| Bloque de color en `admin/crear-cuenta` (1,58:1) | #140: `emerald-*` eliminado (sobrevive solo el comentario que documenta la medición, `crear-cuenta/page.tsx:730`); el guardián ahora ve colores Tailwind con nombre, no solo hex | `frontend/src/lib/__tests__/color-contrast.test.ts` — «no longer carries any of it in the account-creation screen» · 67/67 |
| Indicadores de foco incumplían WCAG 2.4.11 | #151: anillo de dos bandas como regla del sistema (`globals.css:291-304`), adyacencias medidas | `frontend/src/lib/__tests__/focus-ring-usage.test.ts` · 5/5 |
| Cuatro fallos de contraste medidos | #151: corregidos; el peor par de la auditoría (2,31:1) queda como tripwire explícito | `frontend/src/lib/__tests__/color-contrast.test.ts` · 67/67 |
| Objetivos táctiles bajo 44 px | #97 — **cerrado decidiendo que no**: 44 px es AAA (SC 2.5.5); el proyecto adopta AA 24×24 (SC 2.5.8); `h-ctl` queda en 40; el 44 rige en superficies `@touch-target`. Argumento: `docs/ux/objetivo-tactil.md` | `frontend/src/lib/__tests__/touch-target-usage.test.ts` — «leaves the desktop control height alone at 40px» · 7/7 |
| `.split()` en `enrollment-adapter.ts` devolvía 500 | `(fichaMedica.condicionesSalud ?? "")` (`frontend/src/lib/server/enrollment-adapter.ts:74`) | `frontend/src/app/api/enrollment/route.test.ts` — «rejects a fichaMedica without condicionesSalud with 400, not a 500» |
| El handler global mapea `IntegrityError` a 409 | #141 — **cerrado decidiendo que 409 es el contrato**: defensa en profundidad con el razonamiento escrito en `backend/main.py:81-96`; el traceback queda registrado con el `request_id` | `backend/tests/test_main.py::test_integrity_error_no_manejado_responde_409_con_traceback` + `::test_integrity_error_loguea_el_request_id_de_correlacion` |
| El healthcheck no comprobaba PostgreSQL ni Redis | #143: `GET /health/ready` (`backend/main.py:284`) con sondas dedicadas y timeouts de driver; `/health` (`:217`) queda como liveness incondicional **a propósito** | `backend/tests/test_main.py::test_health_ready_responde_503_cuando_postgres_esta_caida` y 12 hermanos, incl. el camino de éxito real sin mocks (#146) |
| Sin correlación de requests | #144: `X-Request-ID` en toda respuesta, entrante validado por lista blanca o `uuid4()`, posición en la pila candada por igualdad (`backend/main.py:141-165`). Métricas y trazas siguen abiertas (ver arriba) | `backend/tests/test_main.py::test_x_request_id_entrante_valido_se_respeta`, `::test_x_request_id_entrante_de_exactamente_128_caracteres_se_respeta` (#146) y hermanos + `::test_orden_de_la_pila_de_middleware_es_el_declarado` |
| El circuit breaker se abría en silencio | #142: registro global + `resumen_circuitos()`; #147: `GET /diagnostico/circuitos` (`backend/main.py:335-354`), solo `ADMINISTRADOR`, separado de `/health` a propósito (las sondas son anónimas; esto es inteligencia operativa) | `backend/tests/test_main.py::test_diagnostico_circuitos_responde_200_con_forma_esperada_para_administrador` (+ 403/401/subset) y `backend/tests/test_circuito_breaker.py::test_resumen_circuitos_refleja_estado_actual_y_es_json_serializable` |
| Los reintentos de alertas podían duplicar notificaciones | Dedup de idempotencia por `(tipo, persona_id, pago_id)`, por destinatario, con orden enviar-luego-marcar (`backend/app/infraestructura/tareas/alertas_tareas.py:134-170`) | `backend/tests/test_alertas_vencimiento.py::test_reintento_no_duplica_notificacion_ni_correo`, `::test_representante_recibe_una_sola_notificacion_en_reintento`, `::test_fallo_de_envio_no_deja_fila_marcada` |
| Columna heredada `ranking.ultimo_combate_o_asistencia` | Eliminada por la migración `c9e4b1d78f30`; la lista de exclusiones del test de drift quedó vacía | `backend/tests/test_drift_migraciones.py::test_no_hay_drift_entre_modelos_y_migraciones` — ya sin exclusiones, también cubre las columnas muertas de `Ranking` |
| `institucion_repositorio` sin paginación ni conteo | #138: `listar(skip, limit)` + `contar()`, envelope `PaginatedResponse`, BFF forwardea, `fetchInstituciones` drena páginas | `backend/tests/test_paginacion_listados.py::test_instituciones_pagina_sin_solape_con_orden_estable` y 3 hermanos + `test_orden_rutas.py` + `test_sin_n_mas_uno.py::test_institucion_listar_no_incurre_en_n_mas_uno` |
| Aprobación de pago sin bloqueo (consultar-y-escribir) | #19: `SELECT ... FOR UPDATE` sobre la fila del pago (`membresia_pago_servicio.py:495-503`); revalidar ya no reactiva membresía ni duplica efectos | `backend/tests/test_pago_comprobante_atomico.py::test_dos_aprobaciones_concurrentes_solo_una_gana` |
| Capacidad de nivel sin bloqueo | #19: `obtener_por_id_bloqueado` (`ranking_servicio.py:90-96`) | `backend/tests/test_invariantes_constraints.py::test_dos_asignaciones_concurrentes_no_exceden_la_capacidad_del_nivel` |
| Guarda de último administrador sin bloqueo | #19: la fila del catálogo `ADMINISTRADOR` como mutex (`rol_servicio.py:69-77`) | `backend/tests/test_invariantes_constraints.py::test_operaciones_concurrentes_sobre_los_dos_ultimos_admins_dejan_al_menos_uno` |
| Un pago podía asociarse a una membresía ajena | Chequeo de pertenencia; 403, no 404 | `backend/tests/test_ownership_pagos.py::test_alumno_no_puede_registrar_pago_contra_membresia_ajena` |
| Restablecer contraseña no revocaba sesiones | Revocación unificada vía `version_sesion` | `backend/tests/test_revocacion_unificada_sesiones.py::test_restablecer_contrasenia_invalida_tokens_previos` |
| Suspender una cuenta no revocaba tokens | Ídem, más rechazo de usuario inactivo | `::test_desactivar_cuenta_invalida_access_token_previo`, `::test_usuario_inactivo_es_rechazado_aunque_el_sver_coincida` |
| Quitar un rol no retiraba privilegios | Ídem | `::test_quitar_rol_invalida_access_token_previo` |
| Desactivar una persona no revocaba tokens | Ídem | `::test_baja_logica_de_persona_invalida_access_token_previo` |
| Aprobación de pago y comprobante no atómicos | Tarea `reconciliar_comprobantes_faltantes` cada 15 min, umbral 10 | `backend/tests/test_pago_comprobante_atomico.py::test_reconciliacion_redespacha_solo_aprobados_viejos_sin_comprobante`, `::test_redespacho_es_idempotente_si_ya_hay_comprobante` |
| Recuperación informaba éxito aunque se perdiera | Registra el fallo y responde `ServicioNoDisponible` | `backend/tests/test_recuperacion_honesta.py::test_publicacion_fallida_con_correo_existente_no_informa_exito` |
| Invariantes financieras vulnerables a concurrencia | Índices únicos parciales (migración `c3d9f2b7a1e5`) + chequeo y constraint responden igual | `backend/tests/test_invariantes_constraints.py::test_dos_pagos_pendientes_para_la_misma_membresia_violan_el_indice`, `::test_dos_membresias_activas_para_la_misma_persona_violan_el_indice`, `::test_pago_pendiente_duplicado_responde_igual_por_chequeo_o_por_constraint` + `test_migracion_invariantes_constraints.py` |
| Faltaba `uq_alumno_horario` | Declarada en `AlumnoHorario.__table_args__` | `backend/tests/test_restricciones_unicidad.py::test_alumno_horario_duplicado_viola_uq_alumno_horario` |
| Los tres listados que crecen con el padrón, sin paginar | `PaginatedResponse` con `skip`, `limit` y conteo | `backend/tests/test_paginacion_listados.py` — envelope y no-solape para alumnos-con-nivel, asignaciones y alumnos-por-horario (6 tests) |
| CI no construía ni levantaba la imagen Docker | Job `docker-images`: construye, levanta el stack real, sondea hasta sano | Candado no-test: `.github/workflows/ci.yml:217` (job) y `:405` (`docker compose ... up -d`) — rojo si la imagen no levanta |
| `frontend`, `celery-worker`, `celery-beat` sin healthcheck | Los siete servicios los declaran (`docker-compose.yml:11,42,51,115,153,198,226`) | Candado no-test: gate de CI `.github/workflows/ci.yml:365` — «Wait until every healthchecked service is healthy» |
| CI en pnpm 9 contra `package.json` en 10.33.2 | Cerrado por construcción: `pnpm/action-setup` lee `packageManager` de `frontend/package.json`, única fuente (`.github/workflows/ci.yml:160-169`) | Sin segunda fuente que pueda derivar; el candado es estructural |

Dos notas que la versión anterior afirmaba mal: la revocación de sesiones
tiene **tres** archivos de test dedicados (`test_revocacion_unificada_sesiones.py`,
`test_sesiones_invalidar.py`, `test_version_sesion.py`), no siete; y
`ErrorState.tsx` **no** mezcla sistemas de tokens — su única mención de
`cata-*` es un comentario (`ErrorState.tsx:6`).

---

## Resumen

Este documento no tiene resumen narrativo, a propósito. La versión anterior
afirmaba el estado dos veces —cuerpo y resumen— y las dos copias envejecieron
por separado hasta contradecirse. Dos lugares donde afirmar lo mismo es un
lugar de más para que uno envejezca. El estado se deriva del cuerpo:

- **Abiertos:** `rg -c '^- \[ \] ' docs/pendientes.md`
- **Cerrados:** `awk '/^## Cerrados/,0' docs/pendientes.md | rg -c '^\|'`,
  menos las dos filas de encabezado de la tabla.
- **La severidad de cada abierto** está en su propio título; no existe otra
  lista que ordene prioridades.

La lección, tres veces pagada: **este documento es una hipótesis con fecha,
no una fuente**. Cada afirmación carga el comando que la re-deriva y cada
cierre carga el test que lo sostiene. Antes de tomar un ítem, corré su
comando; antes de darlo por cerrado, corré su test.
