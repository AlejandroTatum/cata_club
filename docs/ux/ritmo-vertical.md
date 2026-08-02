# Ritmo vertical

Una pantalla es una columna. Lo único que decide si se lee como un sistema o como catorce
maquetas distintas es la distancia entre un bloque y el siguiente.

El issue #31 encontró **cinco idiomas** para expresar esa distancia — `mb-*` en cada bloque,
`flex flex-col gap-5`, `mt-4 flex flex-col gap-4`, `w-full space-y-5`, y bloques crudos sin
envoltorio — repartidos entre las pantallas que el mismo shell dibuja. El efecto no es estético:
un administrador que pasa del panel a miembros ve las mismas fichas moverse.

Este documento define los tres escalones que los reemplazan, registra de dónde sale cada uno, y
deja escrito **lo que el plan de registro pedía y no se hizo**, con la evidencia.

## Los tres escalones

| Escalón | Valor | Trabajo | Deriva de |
|---|---|---|---|
| `page` | 20px | Entre bloques de primer nivel de una pantalla | `h-ctl` (40px) ÷ 2 |
| `section` | 14px | Entre tarjetas hermanas de una grilla, y entre las partes de una | `r-card` (14px) |
| `field` | 7px | Entre una etiqueta y lo que etiqueta | `r-card` ÷ 2 |

Se declaran en `frontend/tailwind.config.ts`, bajo `spacing`, así que sirven a toda la familia de
utilidades: `space-y-page`, `gap-section`, `gap-y-field`.

```tsx
<div className="grid gap-section sm:grid-cols-2 lg:grid-cols-4">
```

**Dos de los tres salen de "La Paleta"**, no de un gusto. `h-ctl` 40px y `r-card` 14px son reglas
duras del diseño aprobado, ya congeladas en `tailwind.config.ts` y verificadas por
`design-tokens.test.ts`. Que `section` sea exactamente el radio de la tarjeta tiene además una
lectura directa: **la calle entre dos tarjetas mide lo mismo que la curva que les recorta las
esquinas**, así que el espacio negativo entre ellas y el de sus propios vértices es el mismo.

`field` es la mitad de `section`, y `page` la mitad del control. La escala es una cadena de
divisiones sobre dos métricas comprometidas, no cuatro números elegidos de a uno.

## Qué dicen los prototipos

`docs/ux/prototipos/_sistema.css` declara `gap` **88 veces**. Esa es la autoridad, y contestó las
tres preguntas sin ambigüedad.

**El ritmo de página es 20px, y lo dice una sola regla porque solo hay un contenedor de página:**

```css
.canvas { flex: 1; padding: 26px 26px 34px; display: flex; flex-direction: column; gap: 20px; }
```

`_sistema.css:152`. En `06-panel.html` los hijos directos de `.canvas` son `h2.h-page`, `.hero`,
`.stats`, `.card` y `.card.pad` — el título de la pantalla y los cuatro bloques, en una sola
columna plana a 20px. **El plan de registro recomendaba `space-y-5`, que es exactamente 20px: la
recomendación estaba bien y ahora tiene respaldo, no solo cinco pantallas de precedente.**

**El escalón de sección es 14px**, declarado cinco veces sobre contenedores verticales o de
grilla: `.grid2` (:203), `.stats` (:222), `.carnet` (:301), `.authcard` (:394) y `.lp-motto`
(:474). `.stats` es literalmente la fila de fichas del tercer criterio de aceptación.

**El escalón de campo es 7px**, declarado siete veces: `.note` (:104), `.pills` (:193), `.stepper`
(:323), `.stp` (:324), `.choice` (:333), `.viewer .vf` (:373) y `.mcard` (:449). `.field` (:200)
—el par etiqueta/control de un formulario— dice 6px, un píxel por debajo; entra en el mismo
escalón con la misma tolerancia de un píxel que la escala tipográfica aceptó sobre 234 usos.

### Y el margen no aparece

En 480 líneas, `_sistema.css` declara `margin-top` o `margin-bottom` **cinco veces**: `.foot` 6px,
`.side .brand span` 1px, `.tbl .sb` 1px, `.choice .sel` 4px y `.lp-hero .cta` 26px. Cuatro son
retoques de un dígito dentro de un componente; la quinta es el CTA de la landing.

**Ninguna separa dos bloques de primer nivel.** Todo el ritmo vertical del sistema está expresado
como `gap` sobre una columna. El segundo criterio de aceptación de #31 —"ninguna pantalla aplica
`mb-*` para separar bloques de primer nivel"— no es una preferencia: es lo que el archivo hace.

## Un idioma por trabajo

El ritmo de página **no lo escribe la pantalla**. Lo escribe el shell, una vez:

```tsx
<main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-page outline-none">
```

`AppShell.tsx` ya envolvía `PageHeader` y `<main>` en una columna a `gap-page`. Llevar el mismo
escalón **adentro** de `<main>` completa la columna de `.canvas`: desde el título de la pantalla
hasta el último bloque hay una sola distancia, y ninguna pantalla tiene que elegirla.

| Trabajo | Idioma | Quién lo escribe |
|---|---|---|
| Bloques de primer nivel | `gap-page` sobre `<main>` | `AppShell`, una vez |
| Tarjetas hermanas de una grilla | `gap-section` | La pantalla |
| Partes de una tarjeta | `space-y-section` | El componente |
| Etiqueta y valor | `space-y-field` · `gap-y-field` | El componente |

La mayoría de las pantallas ya tenía sus bloques como hijos directos de `<main>`: esas solo
sueltan el `mb-*` de primer nivel y el ritmo les llega solo. Las que envuelven su contenido en un
bloque **porque además le fijan un ancho** —`/ayuda` a `max-w-3xl`, `/student/add-dependent` a
`max-w-[760px]`— conservan el envoltorio pero nombran el escalón: `flex flex-col gap-page`. El
envoltorio sigue haciendo su trabajo de ancho; lo que ya no hace es inventar una distancia.

### La corrección de #43: `w-full space-y-page` no era la segunda ortografía, era la misma deriva

La primera versión de esta sección ofrecía **dos** ortografías, `w-full space-y-page` y
`flex flex-col gap-page`, y la sección siguiente —la que mide el velo— desmiente la primera. #43
encontró nueve envoltorios escritos así y ninguno hacía trabajo alguno:

| Lo que escribía el envoltorio | Lo que hace bajo `<main>` |
|---|---|
| `w-full` | nada: `<main>` es `flex flex-col`, y `align-items: stretch` ya da el ancho completo |
| `space-y-page` · `gap-page` | nada: `<main>` ya separa a sus hijos 20px |

Un envoltorio cuya lista de clases es solo eso no fija ancho, no fija ritmo y no dibuja nada. Lo
único que aporta es el nodo capaz de cargar el `margin-top` que la sección siguiente midió mal
sobre un velo `fixed inset-0`. Nueve de esos nodos —en `/trainer`, `/trainer/attendance`,
`/trainer/attendance/history`, `/student` (dos), `/student/attendance`, `/student/payments` (dos)
y `/profile`, más `/admin/crear-cuenta`— desaparecieron: los que JSX obliga a tener una raíz única
pasaron a `<>`, que no emite nodo, y el resto se borró.

El envoltorio con ancho se queda, y por eso el candado solo dispara cuando la lista de clases
**no contiene otra cosa** que ritmo y `w-full`: un `max-w-*`, un `mx-auto` o cualquier utilidad
real lo saca de alcance por construcción.

Ese es el punto: los cinco idiomas no se reducen a una sola etiqueta JSX, se reducen a **un solo
valor con un solo nombre**. Y eso es exactamente lo que el candado puede verificar.

### Por qué `flex flex-col gap` y no `space-y`

Las dos escriben la misma distancia, así que la primera versión de este trabajo usó `space-y-page`
por ser el cambio más conservador: un margen sobre los hijos no toca el modelo de caja del
contenedor. **Medirlo lo desmintió, y vale la pena dejar escrito por qué.**

Varias pantallas montan su modal como hermano de su contenido —`ConfirmDialog` y
`AgeUpConfirmation` se renderizan en línea, sin portal— así que el modal es un hijo de primer
nivel de `<main>`. `space-y-*` le pone `margin-top` a todo hermano posterior, **incluido uno que
está fuera de flujo**. Sobre una caja `fixed inset-0` con `top` y `bottom` fijados, ese margen no
se ignora: desplaza la caja y le resta altura.

Medido contra el CSS emitido, a 1440×900:

| | `space-y-page` en `<main>` | `flex flex-col gap-page` |
|---|---|---|
| velo `fixed inset-0` | `margin-top: 20px`, caja **1440×880 @top 20** | `margin-top: 0`, caja **1440×900 @top 0** |

Veinte píxeles de pantalla sin cubrir arriba del velo, en cada diálogo de confirmación del
producto. Se intentó blindarlo con `m-0` sobre el velo y **no alcanza**: Tailwind emite las reglas
de `space-*` después de las de `margin`, con la misma especificidad, así que gana `space-y`.
Verificado en el bundle: `.m-auto` está en el byte 11227 y `.space-y-5` en el 21417.

`gap` de flex, en cambio, no se aplica nunca a un hijo fuera de flujo: el velo queda inmune por
construcción y no por un parche que la cascada puede revertir. Y es, además, lo que la autoridad
dice — `.canvas` (`_sistema.css:152`) **es** un `display: flex; flex-direction: column`.

El riesgo que se quería evitar quedó descartado por medición aparte: ningún hijo de primer nivel
de las diecisiete pantallas usa `h-full`, `flex-1`, `absolute` ni `min-h-screen`, así que ninguno
cambia de comportamiento al pasar a ítem flex. Y el colapso de márgenes ya no aplica porque este
mismo trabajo retiró los márgenes de primer nivel.

## Lo que no se hizo, y por qué

El plan de registro pedía además **reducir la escala eliminando los medios pasos** `1.5`, `2.5` y
`3.5`. Eso no se hizo, y la razón es la misma que hizo que #29 conservara `font-extrabold`: la
autoridad dice lo contrario.

Contando las 88 declaraciones de `gap` de `_sistema.css` por valor, de mayor a menor:

| Valor | Paso Tailwind | Declaraciones |
|---|---|---|
| 10px | `2.5` | **10** |
| 6px | `1.5` | **9** |
| 8px | `2` | 8 |
| 14px | `3.5` | **8** |
| 7px | — | 7 |
| 11px | — | 7 |
| 9px | — | 6 |
| 12px | `3` | 6 |
| 16px | `4` | 4 |
| 18px · 26px | — | 4 c/u |
| 13px | — | 3 |
| 4px | `1` | 2 |
| 20px | `5` | 1 |

Más una cola de nueve declaraciones sobre ocho valores sueltos (1, 2, 3, 5, 22, 24, 28 y 40px).

**Los tres medios pasos que el plan quería borrar son tres de los cuatro valores más usados del
prototipo.** 10px, 6px y 14px suman 27 declaraciones; los pasos enteros 4, 8, 12, 16 y 20 suman 21
entre los cinco. El prototipo no está sobre una grilla de 4px: su vocabulario de separación es
continuo entre 6 y 14, y los medios pasos de Tailwind son justamente los que caen encima.

Borrar `gap-3.5` habría movido `.stats` —el componente del tercer criterio— fuera de su propia
regla. Borrar `gap-1.5` habría movido los 63 sitios que transcriben `.field`.

Así que la escala **no se reduce por decreto**. Lo que se reduce es la cantidad de idiomas: tres
trabajos, tres escalones nombrados, y el resto del vocabulario numérico sigue disponible para lo
que de verdad es una distancia de un componente. Un escalón nombrado dice *qué relación* separa
dos cosas; `gap-2` dice cuántos píxeles. La deriva que #31 encontró era de los primeros.

## El candado

`arbitrary-style-values.test.ts` gana un octavo eje, `rhythm`, con el patrón **invertido** que #30
estrenó para los iconos: captura la expresión entera y exime únicamente la forma correcta.

- Alcance: los módulos que renderizan `<AppShell>`, es decir las pantallas. Un componente de `ui/`
  no está vigilado, igual que el eje de iconos solo mira archivos que importan `lucide-react`.
- Familias: `space-y-*` y `gap-y-*`, las dos únicas que no hacen otra cosa que ritmo vertical.
  `gap-*` a secas queda afuera porque sobre una fila es horizontal.
- Exención: nombrar un escalón (`page`, `section`, `field`) o `0`, que es un reset explícito.

Se eligió el patrón invertido y no el de paleta cerrada del eje `weight` por lo mismo que en
iconos: una lista de valores prohibidos siempre va un paso atrás del próximo valor que alguien
escriba, y acá el problema nunca fue *qué número* — fue que cinco formas distintas producían "algo
de separación". Una regla que exige la forma correcta no tiene lista a la que volver, y **el eje
`rhythm` no consulta la lista blanca en absoluto**.

Lo que el candado todavía no puede ver, dicho de frente: un `mb-*` sobre un bloque de primer nivel
es estructura, y una expresión regular no ve estructura. El primer criterio lo sostiene la
ausencia de envoltorio, que sí es visible; el segundo lo sostiene, por ahora, la revisión.

## Estado

Migrado en #31:

- El ritmo de página de las diecisiete pantallas de shell, y sus once márgenes de primer nivel.
- `STAT_GRID`, la fila de cuatro fichas de `/dashboard`, `/attendance` y `/members`.
- Las 39 pilas verticales (`space-y-*`, `gap-y-*`) de los módulos que renderizan `<AppShell>`.
  El desplazamiento máximo fue de 5px, en dos `gap-y-0.5` de listas de definición; el resto se
  movió 3px o menos.

**Fuera de alcance, y dicho para que no se lea como terminado:** los componentes de `ui/` y los
módulos que no renderizan `<AppShell>` conservan sus `space-y-*` y `gap-y-*` numéricos, y el
candado no los mira. Las familias `mt-*`/`mb-*`/`py-*` —unas 500 apariciones— tampoco: dentro de
una tarjeta un margen sigue siendo legítimo, y una regla que no distingue el primer nivel del
tercero habría barrido significado junto con la deriva.
