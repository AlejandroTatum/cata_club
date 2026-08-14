# Objetivo táctil

La pregunta vuelve cada vez que alguien mide un botón: **¿por qué `h-ctl` son 40px y no los
44 que todo el mundo cita?** Este documento la contesta con las medidas, la deja escrita, y
nombra el candado que la sostiene.

La respuesta corta: **44px no es el criterio AA**. El proyecto adopta **WCAG 2.2 SC 2.5.8
(AA, 24×24 CSS px)**, no SC 2.5.5 (AAA, 44×44). `h-ctl` se queda en 40px, que clera el piso
AA casi al doble; y las superficies que sí se manejan con el pulgar están en ≥44px por
decisión propia, con un test que no las deja bajar.

## Los dos criterios, y por qué el proyecto eligió el de abajo

| Criterio | Nivel | Mínimo | Estado |
|---|---|---|---|
| SC 2.5.5 *Target Size* | **AAA** | 44×44 | No adoptado |
| SC 2.5.8 *Target Size (Minimum)* | **AA** | 24×24 | **Adoptado** |

El 44 circula como si fuera el mínimo legal porque es el número que publicó Apple en sus
*Human Interface Guidelines*, y porque WCAG 2.0 solo tenía el AAA. WCAG 2.2 agregó el AA en
24×24 justamente porque el 44 resultaba impracticable en interfaces densas de escritorio.

El proyecto no eligió el AA en este documento: ya lo tenía adoptado y candado antes, en el
eje de iconos. `ICON.lg` son 24px y está documentado como *"el mínimo de objetivo WCAG 2.2 SC
2.5.8, así que un control de solo icono que no tenga otra área de golpe puede tomarlo y ser
conforme por tamaño"* (`frontend/src/lib/icon-size.ts:47`). Lo mismo en
`frontend/src/app/login/page.tsx:232,264` y `frontend/src/components/auth/AuthShell.tsx:202`,
con su candado en `LoginPage.test.tsx:124`. Lo que hace este documento es **decirlo en un
lugar donde se busca**, no cambiar el criterio.

## Por qué `h-ctl` no se mueve

Son tres razones y ninguna es estética.

1. **Está firmado.** El prototipo lo declara en `docs/archive/prototypes/prototipos/_sistema.css:58`
   (`--h-ctl: 40px`) y el plan de implementación lo transcribe en
   `docs/archive/prototypes/plan-implementacion-rediseno.md:27`.
2. **Tiene tokens derivados.** `gap-page` son 20px porque son `h-ctl / 2`
   (`frontend/tailwind.config.ts`, y el argumento completo en `docs/ux/ritmo-vertical.md`).
   Subir el control a 44 mueve el ritmo vertical de **todas** las pantallas, no solo la altura
   de los botones.
3. **Compra AAA donde menos hace falta.** Los 40px que quedan son filas de barra lateral y
   botones de cabecera: superficies de escritorio, manejadas con ratón, en las pantallas más
   densas del producto — la cola de pagos y el padrón. Engordarlas suma scroll exactamente
   ahí.

## Qué superficies sí deben 44px

Una superficie táctil no es un hecho geométrico que el código pueda contestar solo: es una
**promesa** que alguien hizo, y quien la hizo es quien escribe el componente. Por eso el
criterio del candado es un **marcador explícito**, `@touch-target`, en el comentario que ya
explica el control.

Se descartaron dos criterios automáticos, y se descartaron con medidas:

- **Por breakpoint** ("todo lo que se dibuja debajo de `lg` es táctil"). Falla en las dos
  direcciones. Falsos positivos: el botón `Menú` del topbar y el de cerrar el drawer son
  ambos `lg:hidden` y miden 40px y 30px **a propósito**, porque el criterio es 24.
  Falsos negativos: los cuatro controles de estado del pase de lista no llevan ningún prefijo
  de breakpoint — miden 44px también en escritorio, porque el entrenador marca la clase
  parado en el gimnasio con el teléfono en la mano.
- **Por archivo** ("el shell y la landing son táctiles"). Se equivoca en los dos extremos por
  lo mismo, y caduca apenas un archivo gana un segundo tipo de control.

### Inventario de lo que ya cumple

Diez promesas, en cuatro archivos. Todas medidas, ninguna cambiada por este documento.

| Superficie | Dónde | Medida |
|---|---|---|
| Tab bar de teléfono | `AppShell.tsx:149` (`TAB_CLASSES`) | `min-h-[44px]` sobre una barra de 62px |
| Enlace «Saltar al contenido» del shell | `AppShell.tsx:411` | `min-h-[48px]` |
| Disco flotante de CATA-BOT | `HelpChatDock.tsx:326` | `h-11` = **44×44** en teléfono; 76×76 desde `lg` |
| Los cuatro controles de estado del pase de lista | `trainer/attendance/page.tsx:1206` | `min-h-[44px] min-w-[44px]`, a todo ancho |
| CTA de la landing | `landing.css:62` (`.landing-button`) | `min-height: 48px` |
| Acción secundaria de la landing | `landing.css:70` (`.landing-button-quiet`) | `min-height: 48px` |
| Skip link de la landing | `landing.css:74` (`.landing-skip-link`) | `min-height: 48px` |
| Enlaces de navegación de la landing | `landing.css:87` | `min-height: 44px` + `touch-action: manipulation` |
| CTA de la barra de navegación | `landing.css:92` (`.landing-nav-cta`) | `min-height: 44px` |
| Los mismos enlaces bajo 768px | `landing.css:268` | `min-height: 44px` |

**La última fila es la razón por la que existe el candado.** Ese override llegó a achicar el
enlace a 40px en el viewport más angosto y más táctil del producto, y se encontró a mano.

### Y lo que queda en 40px, a propósito

| Superficie | Dónde | Medida | Por qué |
|---|---|---|---|
| Filas de la barra lateral | `AppShell.tsx:230` | `h-ctl` = 40px | Escritorio, ratón |
| Botón «Buscar una sección…» | `AppShell.tsx:738` | `h-ctl` = 40px | Escritorio, ratón; tiene atajo `Ctrl K` |
| Botón «Menú» del topbar | `AppShell.tsx:728` | `h-ctl` = 40px | `lg:hidden`, alcanzable con el dedo — 40 ≥ 24 |
| Cerrar el drawer | `AppShell.tsx:463` | icono 18px + `p-1.5` = **30×30** | `lg:hidden`, alcanzable con el dedo — 30 ≥ 24 |

Las dos últimas filas son las honestas: **hay controles que un dedo alcanza y que no llegan a
44px**. Cumplen el criterio adoptado y no llevan marcador. Si algún día el producto decide
prometerles el pulgar, lo que cambia es que ganan `@touch-target` y suben — no que este
documento se reescribe.

## El candado

`frontend/src/lib/__tests__/touch-target-usage.test.ts`, dentro de `pnpm test`, así que ya es
gate del job Frontend del CI. Hace tres cosas:

1. **Mide.** Por cada `@touch-target` lee la altura **base** de la declaración que sigue —
   `min-h-[44px]`, `h-[62px]`, `h-11` de la escala, `h-ctl` resuelto desde el tema,
   `min-height: 44px` en CSS — y falla si baja de 44. Un valor detrás de un prefijo
   (`lg:h-[76px]`) no cuenta: eso es lo que recibe el ratón.
2. **No deja retirar una promesa en silencio.** El padrón del test fija cuántos marcadores
   lleva cada archivo, así que borrar uno falla igual de fuerte que achicarlo.
3. **No puede pasar en vacío.** Falla si el recorrido del filesystem deja de encontrar
   archivos, o si no encuentra un solo marcador.

### Agregar una superficie táctil

Escribir `@touch-target` en el comentario del control, con una línea de por qué el pulgar es
el puntero, y sumar uno al padrón del test. Es un cambio de dos líneas y revisable, que es
exactamente el punto: la decisión la toma una persona, no una heurística.

### El hueco conocido

Un control táctil nuevo que **nunca** reciba el marcador es invisible para el candado. Es el
precio de un candado por adhesión y está asumido: lo que compra a cambio es que ninguna
promesa existente se pueda retirar sin que se note. Los criterios automáticos que lo habrían
cerrado producen los falsos positivos y falsos negativos medidos más arriba, sobre este mismo
código.
