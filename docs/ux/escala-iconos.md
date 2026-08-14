# Escala de iconos

La escala tipográfica reemplazó 24 tamaños de texto escritos a mano. El eje que quedaba
inmediatamente al lado era el de los iconos: `size={N}` aparecía **262 veces en 43 archivos** y
gastaba **catorce tamaños distintos**.

```
10 ×2   11 ×15   12 ×24   13 ×14   14 ×73   15 ×21   16 ×57
17 ×7   18 ×5    19 ×2    20 ×9    21 ×26   24 ×3    32 ×4
```

Diez de los catorce viven entre 10 y 21: once píxeles de rango partidos en diez escalones. Es el
mismo racimo de medio píxel que tenía la tipografía, en el eje que va pegado al texto — y por eso
se nota más: cuando el icono de una fila mide 14 y el de la siguiente mide 16, lo que se
desalinea no es el icono sino la línea base de las dos filas.

Este documento describe los tres escalones que los reemplazan y registra lo que costó cada
colapso.

## Los tres escalones

| Escalón | Tamaño | Deriva de | Acompaña a |
|---|---|---|---|
| `ICON.sm` | 15px | `text-xs` (12,5px) × 1,2 | `text-2xs` y `text-xs`: chips, badges, notas en línea, acciones de celda, botones |
| `ICON.base` | 18px | `text-base` (15px) × 1,2 | `text-sm` y `text-base`: navegación lateral, controles de cabecera, cabeza de fila |
| `ICON.lg` | 24px | `text-lg` (20px) × 1,2 | `text-lg` y más: el icono de un estado vacío, de carga, de error o de confirmación |

Se declaran una sola vez, en `frontend/src/lib/icon-size.ts`:

```tsx
import { ICON } from "@/lib/icon-size";

<Search size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
```

### Por qué 1,2

Un icono casi nunca aparece solo: va al lado de una etiqueta, dentro de un botón, al frente de
una fila. Su tamaño no es una decisión independiente — es el tamaño del texto que acompaña,
multiplicado por la razón que hace que el icono pese lo mismo que las palabras.

`docs/archive/prototypes/prototipos/_sistema.css` ya contesta cuál es esa razón, tres veces, porque declara el
icono y el texto del mismo componente:

| Regla | Texto | Icono | Razón |
|---|---|---|---|
| `.srch` (:154) | 12,5px | 15px | 1,20 |
| `.btn` (:178) | 13px | 15px | 1,15 |
| `.nav-i` (:141) | 13,5px | 17px | 1,26 |

1,20 es el centro de ese rango, y es la única razón que cae en píxeles enteros para más de un
escalón tipográfico: aplicada a `text-xs`, `text-base` y `text-lg` da 15, 18 y 24 exactos. No hay
otra terna de escalones cuyo 1,2 sea entero de punta a punta.

Que la escala de iconos sea un múltiplo constante de la tipográfica es justamente lo que se
buscaba: hereda sus propias razones internas —1,2 de `sm` a `base`, 1,33 de `base` a `lg`— en vez
de inventar un segundo ritmo al lado.

## Qué dicen los prototipos

Los prototipos declaran el tamaño del icono dieciséis veces, y hay que leerlas en dos familias
porque no dicen lo mismo.

**Iconos en línea con texto.** `_sistema.css` no baja nunca de 15px: `.srch` 15, `.btn` 15,
`.nav-i` 17, `.icob` 17, `.sendb` 16, `.phone .tabs2 a` 19. `prototipo-rediseno.html` declara
`.i` a 17px como regla base de **todos** sus iconos, y sube a 18px en `.bell .i` y en
`.rep .ic .i, .ch .ic .i`.

El dato que importa: **ningún prototipo declara un icono en línea menor a 15px.** Los 55 usos que
el código tenía a 10, 11, 12 y 13 no tienen respaldo de ninguna clase. Son exactamente la deriva
"elegida a ojo" que este issue corrige, y subirlos a `ICON.sm` restituye la proporción del
prototipo en lugar de aplanarla: un `Phone size={11}` junto a un `text-xs` daba una razón de
0,88, contra el 1,20 que `.srch` declara para ese mismo par.

**Iconos centrados en un disco.** Aquí el icono no acompaña al texto: lo dimensiona el disco.
Conviene medirlo por tinta, no por caja nominal, porque el trazo de lucide ocupa alrededor de
20 de sus 24 unidades de `viewBox`.

| Regla | Disco | Icono | Tinta / disco |
|---|---|---|---|
| `.toast .ic` (:408) | 20px | 12px | 0,50 |
| `.disc` (:138) | 36px | 21px | 0,49 |
| `.chat > header .disc` (:420) | 32px | 18px | 0,47 |
| `.auth .left .disc` (:386) | 104px | 54px | 0,43 |
| `.emptyst .ic` (:412) | 46px | 21px | **0,38** |

El disco de 46px del estado vacío es el que menos tinta lleva de los cinco. Subir su icono a
`ICON.lg` lo deja en 0,435, que es exactamente la proporción del disco de autenticación. El
colapso no contradice al prototipo: corrige su único caso fuera de banda.

`.statebox .bigicon` (26px) y `.auth .left .disc svg` (54px) quedan fuera de la escala porque
ninguno de los dos tiene contraparte en el producto: son marcas de portada del prototipo.

## Qué absorbe cada escalón

| Escalón | Absorbe | Usos |
|---|---|---|
| `ICON.sm` (15) | 10 · 11 · 12 · 13 · 14 · 15 · 16 | 206 |
| `ICON.base` (18) | 17 · 18 · 19 · 20 | 23 |
| `ICON.lg` (24) | 21 · 24 · 32 | 33 |

Cada valor cae en el escalón más próximo, sin excepciones. Los dos tamaños dominantes —14 con 73
usos y 16 con 57— se mueven un solo píxel, y entre los dos son el 50 % del inventario.

### Los colapsos que mueven más de 2px

Son cinco, y suman 71 de los 262 usos.

| Colapso | Usos | Δ | Dónde |
|---|---|---|---|
| 10 → 15 | 2 | +5 | `Stepper.tsx` (el check del paso cumplido), `MedicalRecordEditor.tsx` (el `Plus` del badge "Nueva") |
| 11 → 15 | 15 | +4 | `members/page.tsx` (14), `NotificationBell.tsx` (1) |
| 12 → 15 | 24 | +3 | Repartidos: `members`, `groups`, `profile`, `crear-cuenta`, `trainer/attendance`, `payments`, `add-dependent`, `enroll`, `NivelLadderScreen` |
| 21 → 24 | 26 | +3 | `EmptyState`, `LoadingState`, `ErrorState` y sus 17 llamadas — el disco de 46px |
| 32 → 24 | 4 | −8 | Tres discos de confirmación (`enroll`, `trainer/attendance`, `crear-cuenta`) y el marcador del visor de comprobante en `payments` |

Los tres primeros son la banda que ningún prototipo respalda. El cuarto está justificado arriba.

## Los tamaños que cargaban geometría

Tres casos donde el tamaño del icono no era solo estético, y qué se hizo con cada uno.

**El disco de confirmación de 64px.** `enroll`, `trainer/attendance` y `crear-cuenta` centraban un
`CheckCircle` de 32px en un `h-16 w-16`: tinta 0,42 del disco. A 24px sobre el mismo disco la
tinta cae a 0,31, muy por debajo de la banda del prototipo. El disco baja a `h-12 w-12` (48px),
con lo que la tinta vuelve a 0,42 — la proporción exacta que tenía — y además queda igual al
disco de confirmación de 48px que `reset-password` y `forgot-password` ya usaban. Es el único
cambio de contenedor de esta migración.

**El check del `Stepper`.** `Stepper.tsx` centra un `Check` en un disco de 18px, que es
`.stp .n` del prototipo (:325) transcrito al píxel. A `ICON.sm` el disco no queda apretado: el
trazo de `Check` es una diagonal que ocupa 16×11 de las 24 unidades del `viewBox`, así que a 15px
mide 10×6,9 dentro de 18px. El disco se deja como está.

**El interruptor de contraseña de `/login`.** Es el objetivo más chico del producto y el que
`LoginPage.test.tsx` vigila contra el criterio 2.5.8 de WCAG 2.2. El área de impacto la da
`h-6 w-6` en el botón, no el icono, y el icono va centrado: pasar de 16 a 15px no mueve su centro
ni toca los 24×24. El test sigue afirmando lo mismo; solo se corrigió la prosa que decía "16px".

`ICON.lg` mide 24px, que es además el mínimo de objetivo del criterio 2.5.8. Un control que sea
solo icono y no tenga otra área de impacto puede tomar ese escalón y cumplir por tamaño.

## El candado se invierte

El eje de iconos ya no lee una lista blanca. Vaciarla habría bastado para que `size={16}` fallara,
pero un literal se escapa por cualquier nombre —`size={iconSize}`, `size={grande ? 24 : 16}`— y un
inventario de catorce tamaños es precisamente en lo que crece uno de esos nombres.

Así que la regla se da vuelta, como ya se había dado vuelta la de pesos: en un archivo que importe
`lucide-react`, **todo `size={…}` es una violación salvo una expresión construida con escalones de
`ICON`**. El eje pasa a ser el segundo que no busca corchetes y el único que captura una expresión
en lugar de un valor.

La exención es deliberadamente estrecha: la expresión tiene que nombrar un escalón y no contener
ningún dígito. `size={ICON.base}` pasa, y también
`size={variant === "landing" ? ICON.base : ICON.sm}`, porque ninguna de las dos puede contrabandear
un tamaño. `size={ICON.sm + 2}` no pasa.

Con eso, la entrada de iconos no puede volver: ya no hay lista a la que volver.
