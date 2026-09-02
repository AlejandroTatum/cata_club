# Diagnóstico de la superficie de horarios

Procedimiento de **solo lectura** para cuando alguien reporta que los horarios que
se ven en pantalla no son los que el club cargó en la app (issue #899).

Separa dos preguntas que se confunden entre sí y mandan a buscar al lugar equivocado:

| Eje | Pregunta | Clases de hallazgo |
| --- | --- | --- |
| Revisión | ¿Qué código está corriendo? | `revision_drift`, `revision_unavailable` |
| Catálogo | ¿Qué datos sirve, y llegan a la pantalla? | `missing_dynamic_data`, `dynamic_source_unavailable`, `static_schedule_authority` |

> **Este diagnóstico no repara nada.** No escribe, no despliega, no migra y no
> hace `git fetch`. Si encuentras algo, el arreglo se decide y se ejecuta por
> separado, con su propio issue y su propio PR.

## Prerrequisitos

- Un checkout del repositorio. El diagnóstico lee `origin/main` **tal como está en
  tu clon**: actualízalo tú antes, con `git fetch origin main`, o el eje revisión
  comparará contra una referencia vieja.
- El stack local levantado, si quieres observar el catálogo (`make qa-up`). Sin él,
  las fuentes reportan `dynamic_source_unavailable`, que es correcto y esperado.
- Python 3. No requiere la venv del backend, ni Postgres, ni dependencias externas.

No requiere credenciales de ningún tipo. Si un procedimiento te pide pegar un
secreto para correr esto, no es este procedimiento.

## Comandos

```bash
python3 scripts/diagnostico_horarios.py
python3 scripts/diagnostico_horarios.py --json
```

El código de salida es **siempre 0**: esto es un inventario, no una compuerta. Un
hallazgo es la salida esperada, no una falla del proceso. Para consumirlo desde
otra herramienta usa `--json`, cuyo `resumen` trae **siempre las cinco clases**,
aunque estén en cero.

Para correr sus tests, que no tocan la red:

```bash
make test-diagnostico-horarios
```

## Cómo interpretar cada clase

### `revision_drift`

El SHA servido por `/api/health` no es el de la revisión esperada. Se pudo
determinar qué corre, y no es lo que se creía. Los horarios pueden estar bien
cargados y aun así no verse, porque está corriendo código viejo.

Sigue por la ruta de despliegue: qué imagen está corriendo y por qué no es la que
se aprobó. Consulta [staging-redeploy.md](staging-redeploy.md).

### `revision_unavailable`

**No se pudo determinar qué revisión corre.** No es deriva, y la diferencia importa:
perseguir una deriva inexistente es un desvío caro.

El caso más común es `observado: unknown`. Significa que el frontend responde bien
pero `BUILD_SHA` nunca llegó a la imagen. Desde el PR #425, CI pasa
`BUILD_SHA=IMAGE_TAG` al construir la imagen de producción y además rechaza
publicarla si `/api/health` no sirve exactamente esa revisión (issue #927) —
así que un `unknown` en producción **no** puede venir de la ruta de publicación
de CI. Significa que la imagen corriendo no vino de ahí: un `docker compose
build` local sin `BUILD_SHA` exportado, una imagen armada a mano, o algo
similar. Ese es el hallazgo en sí mismo, y hay que ir a la recolección en el
host (más abajo) para determinar de dónde salió esa imagen.

Las otras causas son que el endpoint no respondiera o que faltara el campo. Ahí
revisa primero que el stack esté realmente arriba.

### `missing_dynamic_data`

La fuente **contestó bien** y los datos son los que faltan. Dos formas distintas:

- **Catálogo vacío** (`0 categorías`): no hay horarios publicados. Es un problema de
  carga de datos del club, no de despliegue.
- **Categoría incompleta o descartada** (`«Infantil»: 0 de 2 bloques renderizables`):
  el backend publica la categoría y la pantalla no la muestra, entera o en parte.

El segundo caso es el que más engaña, y es la razón de que este diagnóstico exista.
`mapBlock` (`frontend/src/app/landing/schedule-data.ts`) **descarta en silencio**
todo bloque con un día fuera de `DAY_LABELS`, con `days` vacío, o con horas que no
tengan exactamente el formato `HH:MM` — `9:00` no pasa, `09:00` sí. Si una categoría
se queda sin bloques, `mapPublicSchedules` la elimina completa. No se emite ningún
error en ninguna capa: **la respuesta HTTP se ve impecable mientras la pantalla
muestra menos horarios**. Por eso el diagnóstico no compara payloads, sino que
reproduce ese criterio.

El arreglo suele ser corregir el dato de origen (el día o la hora mal cargados), no
tocar el frontend. Confírmalo antes de cambiar código.

### `dynamic_source_unavailable`

La fuente no contestó, tardó de más, no devolvió JSON, o devolvió una forma que no
corresponde a la publicada. **Significa "no sé qué hay", nunca "no hay nada".**

Un 502 del BFF es exactamente esto. `isPublicSchedules`
(`frontend/src/app/api/schedules/route.ts`) es **todo-o-nada**: alcanza un bloque
mal formado para que se rechace el catálogo entero y no se sirva ninguna categoría.
Un catálogo vacío y un catálogo rechazado se ven parecidos en pantalla y son
problemas distintos; no los trates igual.

Con el stack local apagado esta clase aparece para las dos bocas y no indica nada
malo. El reporte consulta el BFF y el backend por separado justamente para que
puedas distinguir "el backend no publica" de "el BFF no lo está pasando".

### `static_schedule_authority`

Esta clase detecta si sigue existiendo una lista **estática** de horarios
sirviendo alguna superficie real: `backend/app/servicios_negocio/conocimiento_club.json`,
leída por el prompt del chatbot (`conocimiento_club.py`) y por la página `/ayuda`
(`faq-content.ts`, `FAQ_SCHEDULES`).

Ambas migraciones ya están cerradas. #789 quitó la lista estática de la landing.
La del chatbot y la de `/ayuda` las quitó #926, resuelto por el PR #928. #899
(detectar drift de horarios) también está cerrado.

El detector se mantiene igual porque su valor no era señalar un pendiente
conocido, sino poder detectar una **regresión**: si alguien reintroduce una
lista estática en cualquiera de esas superficies, o agrega una nueva, esta
clase la vuelve a encontrar.

**Se reporta, no se repara.** Si esta clase da un positivo, no edites
`conocimiento_club.json` como parte de un diagnóstico — eso indica que la
migración cerrada se rompió, y corregirlo es un cambio de código con su propio
issue, no un paso del procedimiento de diagnóstico.

## Salvedad del espejo

El conteo de bloques "renderizables" lo produce una reimplementación en Python de
`mapBlock`/`mapPublicSchedules` y de `isPublicSchedules`. Es un **espejo**: si ese
TypeScript cambia y el script no, el conteo queda desactualizado. Está declarado
así a propósito, en el docstring del módulo y en la salida del reporte. Si ves que
los criterios de la landing cambiaron, actualiza el script antes de confiar en el
conteo — un espejo con su salvedad escrita vale más que un verde falso.

## Lo que este procedimiento NO puede hacer

Desde una máquina local **no se pueden leer los SHA realmente desplegados**. Viven
en archivos `0600` del host de despliegue: el `IMAGE_TAG` del `.env` del stack, el
registro de release, las etiquetas de imagen de `docker compose ps` y el `HEAD` del
checkout desplegado.

**Este repositorio no trae herramientas para leerlos y el script no lo intenta.**
No busques rodearlo copiando esos archivos, ni pegues su contenido en un issue o en
un PR.

Si el eje revisión terminó en `revision_unavailable` y necesitas cerrar la pregunta,
esa recolección es un **paso aparte, ejecutado por el operador con acceso ya
autorizado al host**, siguiendo [provisioning.md](provisioning.md) y
[staging-redeploy.md](staging-redeploy.md). Trátala con el mismo cuidado de
secretos y PII que cualquier operación de producción, y reporta de vuelta solo los
SHA, nunca el contenido de los archivos.

## Escalamiento

- Si el diagnóstico se contradice con lo que ves en pantalla, **detente y conserva
  la salida completa** (`--json`) antes de cambiar nada. Una corrida equivalente
  produce siempre la misma salida, así que sirve como evidencia comparable.
- Si un hallazgo sugiere editar código de la aplicación, eso ya no es este
  procedimiento: abre un issue con la salida adjunta y arréglalo por PR, con el
  diagnóstico como evidencia del antes.
- Si necesitas el eje revisión y no tienes acceso autorizado al host, **no lo
  fuerces**: escala el caso a quien lo tenga.
- Ante cualquier duda sobre si una acción es de solo lectura, no la ejecutes.
