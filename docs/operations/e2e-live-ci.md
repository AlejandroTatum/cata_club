# E2E en vivo programado (`e2e-live.yml`)

Runbook del workflow `.github/workflows/e2e-live.yml` (issue #901).

Los specs `*.live.spec.ts` no simulan el backend: lo atraviesan. Necesitan el
stack de QA completo — Postgres con el dataset grande sembrado, Redis, Mailpit,
`celery-worker` y el frontend ya construido — y eso cuesta entre 15 y 25 minutos
antes de que corra el primer test. Por eso no están en `ci.yml`: ningún PR puede
pagar esa cuenta en cada push. Corren programados.

El contrato del archivo está bajo candado en `tests/test_e2e_live_workflow.py`,
que lo lee estáticamente y verifica disparadores, permisos, ausencia de
credenciales, teardown y artefactos. Ese test corre en cada PR
(`.github/workflows/ci.yml:138` ejecuta el directorio `tests/` entero).

## Cadencia

Diario, `17 6 * * *` en UTC — 01:17 en Ecuador (UTC-5).

Dos razones para esa hora:

- Es madrugada local. Nadie está mirando QA a mano ni pusheando a `main`, así
  que el commit que se construye no se mueve debajo de la corrida.
- El minuto `:17` evita el minuto en punto. GitHub encola en la misma tanda los
  workflows programados de `:00` y la retrasa cuando hay carga; un job que ya
  tarda 20 minutos no necesita además esperar en la fila.

## Disparo manual

Actions → **E2E Live (QA stack)** → *Run workflow*. El input `sha` es opcional:
vacío corre la rama por defecto.

También es reusable: un flujo de release puede llamarlo con `workflow_call` y el
mismo input, en vez de copiarse los pasos.

### La restricción del SHA — leer antes de dispararlo a mano

**El `sha` que pases tiene que ser `main` o un descendiente suyo.**

`make qa-up` corre `git fetch origin main` y después
`scripts/qa_verify_build_sha.py`, sin guarda y sin `|| true`. Ese script compara
el SHA que el contenedor sirve por `/api/health` contra `origin/main` y solo
acepta dos casos:

| Commit que pasás | Resultado |
| --- | --- |
| `main` (la corrida programada) | pasa |
| Un descendiente de `main` (candidato de release, tag pre-release) | pasa |
| Un commit **detrás** de `main` | **falla**: código viejo |
| Una rama de feature **divergida** | **falla**: no se puede verificar |

Los dos casos que el issue #901 pide — la corrida nocturna sobre `main` y la
verificación manual de un candidato de release — caen del lado que pasa. Una
rama de feature no, y eso es a propósito: el guard existe (issue #350) para que
una captura de QA no pueda ser evidencia de código que ya no es el actual.

Si necesitás correr los live specs sobre una rama divergida, hacelo local con
`make qa-up && make qa-live` desde esa rama; el guard va a fallar igual, pero
ahí ves el mensaje y decidís. **No se modifica el script** para acomodar el
workflow.

El checkout usa `fetch-depth: 0` por esto mismo: el guard decide con
`git merge-base --is-ancestor`, y un clon somero no tiene ancestros que
recorrer.

## Credenciales: ninguna

El workflow no declara ni consume ninguna credencial del repositorio, y el test
lo verifica. No es una omisión, es el diseño del stack de QA:

- `JWT_SECRET_KEY` la genera el propio `Makefile:188` con `openssl rand -hex 32`
  en cada invocación de `make`. El entorno es desechable y su base se destruye
  en cada `qa-up`, así que no hay ninguna sesión que preservar entre corridas.
- El SMTP está fijado a literales en `docker-compose.qa.yml:75-85`, apuntando al
  Mailpit de la red de Compose. QA no puede heredar el proveedor de correo del
  operador ni aunque alguien exporte las variables.

Si alguna vez este workflow pareciera necesitar una credencial, la pregunta
correcta no es cuál agregar sino qué cambió en el stack de QA.

## Artefactos

Cuando el job falla se sube **solo** `frontend/playwright-report/`, con
`retention-days: 7`. Mismo criterio que `ci.yml:253-259`.

`frontend/test-results/` **no se sube nunca.** `frontend/playwright.config.ts`
combina `retries: 1` bajo CI (línea 37) con `trace: "on-first-retry"` (línea 53),
así que cada test que falla escribe un trazo que incluye los encabezados
`Cookie` y `Set-Cookie` de la sesión que usó. El token es efímero por
construcción, pero un artefacto vive siete días y lo descarga cualquiera con
acceso de lectura al repositorio. El reporte HTML alcanza para diagnosticar.

## Leer una falla

1. **Mirá en qué paso murió.** No es lo mismo `Bring up the QA stack` que
   `Run live E2E specs`: el primero es infraestructura, el segundo es la
   aplicación.
2. **Si murió en `Bring up the QA stack`**, el paso
   `Dump bounded QA logs (on failure)` ya imprimió `docker compose ps -a` y las
   últimas 200 líneas de cada servicio. Los sospechosos habituales, en orden:
   el guard de SHA (mensaje explícito nombrando ambos commits), un healthcheck
   que no llegó a verde, o el smoke de recuperación por Mailpit — que tiene su
   propio timeout de 30s y depende de que `celery-worker` esté arriba.
3. **Si murió en `Run live E2E specs`**, bajá el artefacto
   `playwright-report-live` y abrí el HTML. No hay trazos; si el reporte no
   alcanza, reproducí local con `make qa-up && make qa-live`, que es exactamente
   lo que el workflow corre.
4. **El teardown corre siempre** (`if: always()`), así que un job rojo no deja
   contenedores ni volúmenes colgados.

## Verificación posterior al merge

Dos criterios de aceptación del issue #901 **no se pueden cerrar mergeando este
PR**, y conviene decirlo antes de que alguien los marque como hechos:

- `schedule:` solo dispara cuando el archivo está en la rama por defecto. La
  primera corrida nocturna ocurre después del merge, no antes.
- `workflow_dispatch:` solo aparece en la pestaña Actions cuando el workflow ya
  está en la rama por defecto. Antes del merge no hay botón que apretar.

Entonces, después de mergear:

1. Esperar **dos corridas programadas consecutivas en verde**. Con cadencia
   diaria son dos madrugadas.
2. Disparar **una corrida manual en verde**, con `sha` vacío o con un
   descendiente de `main`.
3. Recién ahí cerrar el issue.

Si la primera corrida nocturna sale roja, es señal real: son los primeros live
specs que corren contra un stack levantado desde cero en un runner limpio, y
cualquier dependencia implícita del entorno local aparece justo ahí.

### Estado a la fecha (2026-09-01)

El PR #939 ya está mergeado en `main` (`6eab598`), así que el workflow ya vive
en la rama por defecto. Eso resuelve la condición de arranque, pero no el
criterio de cierre del issue #901: a esta fecha no existe todavía **ninguna
corrida verde de ningún tipo**.

| Tipo de corrida | Cantidad hasta hoy | Resultado |
| --- | --- | --- |
| Programada (`schedule:`) | 0 | ninguna corrida todavía |
| Manual (`workflow_dispatch:`) | 1 (id `33562412916`, 2026-09-01T21:41:13Z) | FAILURE |

Detalle por paso de esa única corrida manual:

- `Bring up the QA stack` — success
- `Run live E2E specs` — **FAILURE**
- `Dump bounded QA logs (on failure)` — success
- `Upload Playwright Report (on failure)` — success
- `Tear down` — success

Lectura correcta: la infraestructura del workflow funcionó de punta a punta —
el stack levantó, el volcado acotado de logs corrió, el reporte de Playwright
se subió y el teardown limpió sin dejar nada colgado. Lo que falló fueron los
specs en vivo, no el mecanismo que los corre.

La causa identificada es el issue #940, "el administrador sembrado queda
atrapado en la compuerta de activación": el admin sembrado aterriza en
`/login/activacion` en lugar del dashboard. #940 está **abierto** y es el
bloqueo actual para que cualquier spec en vivo pase.

**Criterio real de cierre de #901**, que a esta fecha sigue sin cumplirse:

1. Corregir #940.
2. Obtener **una corrida manual en verde**.
3. Obtener **dos corridas programadas consecutivas en verde**.

Las tres condiciones son necesarias. #901 no se cierra por tener el workflow
mergeado ni por la corrida manual roja ya registrada: a la fecha de este
documento no existe ninguna corrida verde de ningún tipo, y esta sección
existe para que una auditoría futura no marque #901 como hecho antes de que
esas tres condiciones se cumplan.
