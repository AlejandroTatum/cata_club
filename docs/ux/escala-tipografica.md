# Escala tipográfica

`frontend/tailwind.config.ts` tokenizaba color, familia, espaciado, alturas, radios, sombras y
anchos. No tokenizaba `fontSize`: la tipografía era el único eje del sistema que nunca se nombró,
y el resultado medido eran **24 tamaños distintos** escritos a mano en 331 lugares, con racimos
como `12.5` + `13` + `13.5` separados por medio píxel.

Este documento describe la escala que reemplaza esos 24 tamaños y registra lo que costó cada
banda al migrar. Los 24 tamaños ya están migrados, y los pesos consolidados: el issue #29 está
cerrado.

## Los ocho escalones

Cada escalón se declara en la forma de tupla de Tailwind, `[tamaño, { lineHeight, letterSpacing }]`.
Elegir un escalón resuelve las tres decisiones de una vez.

| Escalón | Tamaño | Interlineado | Tracking | Para qué |
|---|---|---|---|---|
| `text-2xs` | 10,5px | 1,4 | +0,12em | Microetiqueta en mayúsculas: cabecera de tabla, kicker, texto de badge |
| `text-xs` | 12,5px | 1,5 | 0 | Metadato secundario: texto de ayuda, fechas, texto de chip |
| `text-sm` | 13,5px | 1,5 | −0,005em | Interfaz densa: celda de tabla, etiqueta de formulario, fila de lista |
| `text-base` | 15px | 1,45 | −0,01em | Cuerpo. El tamaño de lectura por defecto del producto |
| `text-lg` | 20px | 1,2 | −0,02em | Título de card, título de diálogo, nombre que encabeza una fila |
| `text-xl` | 26px | 1,15 | −0,03em | Título de página |
| `text-2xl` | 32px | 1,05 | −0,04em | Número de stat |
| `text-display` | 46px | 0,95 | −0,05em | Titular de héroe: panel de auth, landing, "próxima sesión" del entrenador |

### Por qué esos valores

**No se inventaron.** `xl` es exactamente el título de 26px que ya renderiza
`components/ui/PageHeader.tsx`, `2xl` es el número de 32px de `components/ui/StatCard.tsx` y
`display` es el titular de 46px del login. La escala se transcribió de los componentes ya
aprobados, así que migrar un `text-[26px]` existente a `text-xl` no mueve un píxel.

**La razón entre escalones crece de abajo hacia arriba:** 1,19 · 1,08 · 1,11 · 1,33 · 1,30 ·
1,23 · 1,44. La base es densa porque entre 10 y 15px conviven la etiqueta, el valor y el cuerpo,
y tienen que distinguirse de un vistazo; la cima es aireada porque un titular solo compite
consigo mismo.

**El tracking sigue al tamaño, como debe ser.** A 46px un tracking normal se lee como separación
entre letras; a 10,5px se lee como una mancha. De ahí −0,05em arriba y +0,12em abajo. Que el
escalón lo traiga puesto es justamente lo que evita que cada titular vuelva a tomar la decisión.

**El interlineado también.** 1,5 en texto de interfaz, 0,95 en un titular de 46px. Un titular con
interlineado de cuerpo se lee como dos líneas sueltas, no como un bloque.

## Qué absorbe cada escalón

Los 24 tamaños del inventario congelado, repartidos:

| Escalón | Absorbe |
|---|---|
| `2xs` | 9 · 9,5 · 10 · 10,5 · 11 · 11,5 |
| `xs` | 12 · 12,5 |
| `sm` | 13 · 13,5 · 14 |
| `base` | 14,5 · 15 · 17 |
| `lg` | 20 |
| `xl` | 24 · 26 · 27 |
| `2xl` | 30 · 32 |
| `display` | 40 · 42 · 46 · 56 |

Los racimos de medio píxel desaparecen por construcción: `13` + `13,5` + `14` caen en `sm`, y
`14,5` + `15` + `17` en `base`. Nadie percibía la diferencia; el sistema deja de ofrecerla.

**Dos casillas de esta tabla se corrigieron al migrar la banda de cuerpo.** La primera versión
mandaba `13` a `xs` y `14,5` a `sm`, y ninguna de las dos era la más cercana: `13` está a medio
píxel de `xs` y de `sm` por igual —el empate se resuelve hacia arriba, que es donde viven sus
otros 83 usos de interfaz densa—, y `14,5` está a medio píxel de `base` pero a un píxel entero
de `sm`. Reasignarlas es lo que hace que la migración sea un redondeo al escalón más próximo y
no una lista de excepciones.

## Los escalones nombrados de tracking e interlineado

Existen para los casos en que un valor tiene que **contradecir** el que trae su escalón de
tamaño — un texto en mayúsculas a tamaño de cuerpo, o un titular que no debe heredar el
apretado de su escalón. No son un segundo catálogo.

| Token | Valor | Cuándo |
|---|---|---|
| `tracking-dense` | −0,02em | Apretar a un tamaño cuyo escalón no aprieta lo suficiente |
| `tracking-flat` | 0 | Cancelar un tracking negativo heredado (datos tabulares, códigos, identificadores) |
| `tracking-caps` | 0,12em | Mayúsculas a tamaño chico. El default de `2xs`, reutilizable |
| `tracking-caps-wide` | 0,2em | Mayúsculas que deben leerse como una regla, no como una palabra |
| `leading-crisp` | 1,15 | Titular que envuelve y tiene que seguir siendo un bloque |
| `leading-body` | 1,45 | El default de `base`, aplicado a otro tamaño |
| `leading-prose` | 1,55 | Párrafo largo: ayuda, textos legales, prosa de estado vacío |

**Los nombres están deliberadamente fuera del vocabulario de Tailwind.** `tracking-tight` tiene 14
usos, `tracking-wider` 8, `leading-relaxed` 47, `leading-tight` 7 y `leading-none` 7: 83 usos que
el candado no vigila y que nadie está revisando en este issue. Redefinir una de esas claves movería
tipografía que nadie pidió mover. Por eso estos escalones **extienden**, no reemplazan.

## La colisión de `fontSize`, y cómo se resolvió

`fontSize` sí redefine las claves estándar: declarar `xs`…`2xl` en `extend` cambia el significado
de toda clase `text-*` que ya estaba escrita. El candado no puede verlo — son clases legítimas
cuyo valor cambia por debajo.

| Clase | Antes | Ahora | Usos | Decisión |
|---|---|---|---|---|
| `text-xs` | 12px | 12,5px | 122 | Se deja. +0,5px |
| `text-sm` | 14px | 13,5px | 106 | Se deja. −0,5px |
| `text-base` | 16px | 15px | 6 | Se deja. −1px |
| `text-lg` | 18px | 20px | 5 | **Reescritas como `text-[18px]`** |
| `text-xl` | 20px | 26px | 1 | **Reescrita como `text-lg`**, que mide 20px exactos |
| `text-2xl` | 24px | 32px | 7 | **Reescritas como `text-[24px]`** |

Los 234 usos que se dejaron entran al sistema gratis: la deriva máxima es de 1px y a cambio
heredan el interlineado y el tracking del escalón. Los 13 que se movían de forma visible se
reescribieron a mano en el mismo commit, para que la rama nunca aterrice en `main` con un cambio de
tamaño que nadie decidió.

Dos de esas reescrituras dejaron deuda a propósito, y la migración de la banda display ya la saldó:

- **`text-[18px]`** fue la única entrada que se agregó jamás a la lista blanca del candado. Sus
  cinco usos —el wordmark del header, la portada de la card de cuenta creada y el título del
  diálogo de miembro— son todos encabezados, así que subieron a `lg` (20px). Bajarlos a `base`
  los habría dejado del tamaño del cuerpo que encabezan. La entrada está borrada.
- **`text-[24px]`** cayó entero en `xl` (26px), que es el escalón que la tabla de absorción ya le
  asignaba y el que el candado sugiere: 24 está a 2px de `xl` y a 4px de `lg`.

Donde el interlineado venía del propio `text-*` y el cambio superaba 1px, la reescritura lo fijó con
el escalón numérico de Tailwind que lo reproduce exacto (`leading-7` = 28px, `leading-8` = 32px).
Eran andamios y ya no están: al elegir el escalón definitivo, el interlineado vuelve a viajar con
el tamaño, que es el punto de la escala.

## Lo que costó la banda de cuerpo

145 líneas, seis tamaños retirados de la lista blanca. Tres decisiones no fueron mecánicas:

- **17px → `base` (15px), −2px, ocho usos.** Son subtítulos de sección (`trainer`, `payments`,
  `student/payments`, `student` ×3, `PaymentBand`, `student/attendance`). Subirlos a `lg` (20px)
  los habría puesto a la altura de un título de card; el escalón más cercano es `base`, y a esa
  distancia el subtítulo sigue separándose del cuerpo por peso, que es como venía separándose.
- **`sm:text-[17px]` desapareció entero.** En `payments/page.tsx` el nombre del solicitante subía
  de 15 a 17px a partir de `sm`. Los dos extremos caen en `base`, así que el escalón responsivo se
  quedó sin diferencia que expresar y la clase se retiró en lugar de duplicarse.
- **Los overrides que ya no se ganaban el lugar.** Los cuatro `tracking-[-0.015em]` estaban a
  0,005em del tracking que `base` trae puesto y se borraron; el `-0.02em` de la cuota vencida sí
  contradice a su escalón y pasó a `tracking-dense`. Igual el interlineado: `leading-[1.45]` del
  chat cedió al 1,5 de `sm`, `leading-[1.25]` de la stat de `student` pasó a `leading-tight`
  —mismo valor, escalón de fábrica— y el `leading-[1.35]` del toast cedió al 1,5 de `sm`, que le
  agranda la caja de línea 2,03px por renglón. Es el único cambio de altura de la banda.

## Lo que costó la banda densa

74 líneas, dos tamaños retirados de la lista blanca. Es el grupo más grande del inventario y,
a la vez, el más barato: `text-[12.5px]` cae **exacto** sobre `xs`, así que 69 de sus 74 usos no
mueven un píxel de tamaño. Los otros cinco eran `text-[12px]` y suben 0,5px.

Lo que sí se mueve en esos 69 usos es sutil y conviene decirlo: la clase arbitraria emitía
`font-size` y nada más, así que su interlineado venía del `1.5` del preflight y su tracking era
`normal`. `xs` trae 1,5 y 0em. Son los mismos valores, ahora declarados en un solo lugar.

Cuatro decisiones sobre los overrides que viajaban en esas líneas:

- **`leading-[1.5]` del cierre de `ayuda`** se borró: es el mismo 1,5 que trae `xs`. Cambio nulo.
- **`leading-[1.45]` del hint de primera vez y del cuerpo del toast** se borraron. A 12,5px la
  diferencia contra 1,5 es 0,625px por renglón, la misma clase de override que la banda de cuerpo
  ya había retirado.
- **`leading-[1.55]` de la respuesta del FAQ** se conservó como `leading-prose`. No por la
  distancia —también es 0,625px— sino porque ese escalón existe justamente para "ayuda, textos
  legales, prosa de estado vacío", y la respuesta del FAQ es el caso que lo nombra.
- **`leading-[1.25]` de la marca en `student`** pasó a `leading-tight`, escalón de fábrica de
  valor idéntico. A 3,1px de su escalón, ahí sí hay una decisión que sostener.
- **`tracking-[0.06em]` de la acción del toast** pasó a `tracking-wider` (0,05em). Es una palabra
  en mayúsculas: dejarla en el 0em de `xs` la habría cerrado. La diferencia es 0,125px por letra.

No hubo ninguna línea responsive en esta banda: `rg` sobre clases con prefijo de breakpoint y
tamaño arbitrario no devuelve nada en todo `frontend/src`. La única pareja responsive viva sigue
siendo el `min-[980px]:text-display` + `min-[980px]:leading-crisp` de `AuthShell`.

## Lo que costó la banda micro

91 líneas en 29 archivos, seis tamaños retirados. Con esto **los tres ejes tipográficos de la
lista blanca del candado quedan vacíos**: ya no hay forma de escribir un tamaño, un interlineado
ni un tracking sin nombrar un escalón. Solo quedan los ejes de iconos, sombras y breakpoints,
que son los issues #30 y #32.

### El colapso de 11,5px, que es el ítem de riesgo de toda la migración

Veintidós usos bajan 1px, y dos de ellos viven en primitivas compartidas: la etiqueta de
`components/ui/Badge.tsx` y la segunda línea de la celda de identidad de
`components/ui/Table.tsx`. Un píxel en un componente aislado es un píxel; un píxel en `Table` es
un píxel en toda vista con tabla, y en `Badge`, en toda vista con estado.

Conviene decir lo incómodo: **11,5px sí tiene autoridad de prototipo**. `_sistema.css` lo escribe
para la etiqueta del badge y `prototipo-rediseno.html:271` para el pagador de la tarjeta de pago.
No es una inflación tomada por fuera de la especificación, como sí lo era el 56px de la banda
display. Se acepta igual, y por una razón declarada: la tabla de absorción de esta misma escala
—aprobada en el eslabón 1— manda 9 · 9,5 · 10 · 10,5 · 11 · 11,5 a `2xs`, y sostener 11,5px
aparte significaría un noveno escalón a 1px del octavo, que es exactamente el racimo de medio
píxel que la escala vino a disolver.

Lo que **no** cambia con el píxel: las dos reglas duras de "La Paleta" que rodean estos usos son
alturas fijas, no tipográficas —`h-badge` 26px, `h-row` 60px, `h-thead` 44px, `h-ctl-sm` 32px—,
así que achicar el texto les deja más aire, nunca menos. Y el par de contraste del badge se
justifica en `_sistema.css` contra el umbral de texto normal (4,5:1), no contra el de texto
grande: 11,5px/700 y 10,5px/700 están los dos del mismo lado de ese umbral, así que los
4,98 / 4,97 / 5,05 medidos siguen valiendo.

### La decisión central no fue el tamaño: fue el tracking que trae `2xs`

`2xs` es el único escalón con tracking **positivo**: 0,12em. Es su razón de ser —una
microetiqueta en mayúsculas a 10,5px sin tracking se lee como una mancha— pero se aplica a todo
lo que tome el escalón, no solo a las mayúsculas. La banda micro se parte casi en dos por ahí:

- **45 líneas en mayúsculas.** Cuarenta y una traían `tracking-[0.1em]`, `[0.12em]` o `[0.13em]`:
  el mismo gesto escrito tres veces con 0,03em de dispersión. Las tres clases **se borran** y el
  escalón pone su 0,12em. No es una aproximación cómoda: el prototipo mismo pide 1,3px sobre
  10,5px en `thead th` y 1,4px en `.stat .lab`, o sea 0,124em y 0,133em, que están más cerca de
  los 0,12em del escalón que de los 0,1em que el código escribía. El movimiento real es de
  +0,21px por letra en las 29 líneas de 0,1em y de −0,105px en las nueve de 0,13em.
- **46 líneas que no son mayúsculas.** Badges, correos truncados, contadores dentro de un disco,
  el atajo de teclado, la letra chica de auth. Ahí 0,12em no es un default útil sino un defecto
  de 1,26px por carácter: ensancha texto con `whitespace-nowrap`, descentra un dígito dentro de
  un círculo y estira una dirección de correo que ya venía truncada. Las 46 llevan
  **`tracking-flat`**, que es el escalón que existe justamente para cancelar el tracking de un
  escalón de tamaño y que hasta este PR no tenía un solo uso.

Es la primera vez en la cadena que migrar un tamaño **agrega** una clase en vez de quitarla, y
está bien que así sea: `tracking-flat` declara una decisión que antes estaba implícita en que la
clase arbitraria no emitía `letter-spacing` en absoluto.

### Los overrides restantes

- **`tracking-[0.2em]` del eyebrow del header** pasó a `tracking-caps-wide`, valor idéntico. Es
  el mismo par que la banda display ya había armado en `AuthShell`.
- **`tracking-[-0.01em]` de la unidad de `StatCard`** se borró. Está a 0,005em del tracking que
  `sm` trae puesto —0,0675px por letra a 13,5px—, la misma distancia que retiró el racimo de
  `-0.015em` de la banda de cuerpo. El número de 32px, que es el ancla, no se toca.
- **`leading-[1.2]` y `leading-[1.3]` del carnet de socio** pasaron a `leading-tight` (1,25). No
  se borraron porque contra el 1,4 de `2xs` la caja crecería 2,1px y 1,7px en dos etiquetas que
  ocupan una sola línea dentro de una tarjeta apretada; y `leading-tight` no es una invención
  local, es lo que ya llevan los dos valores hermanos, justo debajo de cada etiqueta. El
  movimiento queda en +1,125px y +0,125px.
- **`leading-[1.5]` de la letra chica de auth** se borró: contra el 1,4 de `2xs` la caja se achica
  1,05px por renglón, dentro de la tolerancia con la que las dos bandas anteriores ya retiraron
  overrides.

Dos escalones nombrados quedan sin usos después de esta banda: `leading-body` (1,45) y —hasta
que se contaron las 46 líneas de arriba— `tracking-flat`. El segundo encontró su caso; el primero
sigue esperando el suyo.

Tampoco acá hubo líneas responsive: la única pareja viva sigue siendo el
`min-[980px]:text-display` + `min-[980px]:leading-crisp` de `AuthShell`.

## Los pesos

El inventario de partida tenía cinco pesos activos: `bold` (143), `semibold` (112), `medium` (91),
`extrabold` (21) y `normal` (7) — 374 usos.

| Peso | Valor | Para qué |
|---|---|---|
| `font-semibold` | 600 | Etiqueta de formulario, botón, nombre de fila, chip, ítem de navegación |
| `font-bold` | 700 | Microetiqueta en mayúsculas, cabecera de tabla, badge, cifra de tabla |
| `font-extrabold` | 800 | Titular, título de página, número de stat, cifra de héroe |

`font-normal` (400) sobrevive pero **no es un cuarto escalón**: sus siete usos deshacen un peso
heredado —una nota dentro de una fila `font-semibold`, la línea de apoyo del toast dentro de un
relleno `font-semibold`— que es lo mismo que hace el `400` de `.hint` en `_sistema.css`. Es la
ausencia de una decisión, no una decisión.

### Se midió el prototipo antes de elegir, y contradijo el plan

El plan de implementación proponía quedarse con `normal` / `semibold` / `bold`, colapsando
`medium → semibold` y `extrabold → bold`. La primera mitad se cumplió; la segunda no, y la razón
está en la autoridad visual.

`docs/archive/prototypes/prototipos/_sistema.css` declara `font-weight` 51 veces sobre cinco valores, y el reparto
no es parejo: **700 treinta y dos veces, 600 veinte, 800 dieciséis — y 500 y 400 exactamente una
vez cada uno.**

- El único `500` es `.nav-i` (:140), el ítem de navegación. O sea que `font-medium` tenía **una
  línea de autoridad y noventa y un usos**: es deriva, no diseño. Se colapsó entero.
- Los dieciséis `800` son la banda display completa: `.stat .num`, `.phead h2`, `.fcard h2`,
  `.hero .big`, `.hero .timechip`, `.sec-t`, `.wizhead h2`, `.carnet .cname`, `.stp .n`, `.lv`.
  De los 21 usos de `font-extrabold` en el código, **los 21 caen sobre una de esas reglas.**

Colapsar `extrabold → bold` habría alejado del prototipo aprobado las dos anclas de la sección
siguiente —el título de 26px de `PageHeader` y el número de 32px de `StatCard`— y otras diecinueve
líneas, en pantallas que no se pueden verificar en un navegador. Bajar un peso que el sistema
declara dieciséis veces no es simplificar: es reescribir el diseño sin decirlo.

### Dónde el peso quedaba solo sosteniendo jerarquía

Después de la banda micro, 91 sitios comparten 10,5px exactos, así que el peso pasó a ser el único
portador de jerarquía por debajo de `xs`. Los cuatro casos que eso pone en riesgo se revisaron uno
por uno, y ninguno perdió su contraste:

- **`components/ui/StatCard.tsx`** sigue siendo un espécimen de tres pesos —etiqueta 10,5px/700,
  valor 32px/800, unidad 13,5px/600— porque `extrabold` no se tocó.
- **`components/ui/Stepper.tsx`** conserva su disco en 800 sobre 10,5px. `_sistema.css:325` lo pide
  (`.stp .n`), y su vecina, la etiqueta de la píldora, es 12,5px/600: difieren en tamaño y en peso.
- **`components/ToastContainer.tsx`** separa la acción del cuerpo del toast con `font-bold` +
  `tracking-wider` + `uppercase`. El relleno del toast subió de 500 a 600, así que la distancia con
  la acción se acorta 100 unidades, pero las otras tres señales —mayúsculas, tracking, subrayado—
  no se tocaron, y la acción sigue siendo lo único en negrita del bloque.
- **Las 45 microetiquetas en mayúsculas** son todas `font-bold`, y ninguna era `medium`: el barrido
  no las alcanzó.

El único contraste que sí se perdió es el quinto canal del ítem de navegación activo. `_sistema.css`
lo separa del inactivo por relleno, color, la barra roja de 3px, el punto `--ball` y 600 contra 500;
al retirarse `medium`, ambos quedan en 600. Los otros cuatro canales, que son los ruidosos, siguen
en pie, y `AppShell.tsx` ya no declara el peso para no aparentar una diferencia que no existe.

### El candado ahora vigila el peso

`arbitrary-style-values.allowlist.ts` suma un séptimo eje. Es el único que no lista deuda que se
achica hasta desaparecer, sino el conjunto cerrado de pesos que el producto puede escribir, y por
eso es el único que se detecta por nombre y no por corchetes: los pesos son clases de fábrica, así
que la deriva nunca escribe un valor arbitrario y los otros seis ejes no la veían. `font-medium`,
`font-light`, `font-black` y las otras cinco fallan la suite.

### `leading-body` cerró la cadena sin un solo uso

De los siete escalones nombrados que definió el eslabón 1, `leading-body` (1,45) terminó el issue
**sin ningún sitio que lo escriba**. No es un descuido de la migración: 1,45 es el interlineado que
`text-base` ya trae puesto, y ningún caso necesitó aplicarlo a otro tamaño. Queda declarado como
el nombre disponible para cuando aparezca ese caso; si no aparece, es una línea de
`tailwind.config.ts` para borrar.

## Anclas que no se mueven

Son las dos reglas duras de "La Paleta" y sirven de control negativo de cualquier verificación
visual de este eje:

| Componente | Elemento | Valor |
|---|---|---|
| `components/ui/PageHeader.tsx` | título de página | 26px — cae exacto en `xl` |
| `components/ui/StatCard.tsx` | número de stat | 32px — cae exacto en `2xl` |

Ya están escritas como `text-xl` y `text-2xl`. El tamaño y el tracking renderizados no se movieron
—`text-xl` es 26px/−0,03em y `text-2xl` es 32px/−0,04em, exactamente lo que decían las clases
arbitrarias—. `StatCard` además lleva `leading-none`, así que su caja de línea tampoco cambió;
el título de `PageHeader` no declaraba interlineado y por lo tanto heredaba el 1,5 del `html`, y
ahora toma el 1,15 de su escalón: la caja pasa de 39px a 29,9px. Es el cambio que la escala
existe para hacer —un titular de página con interlineado de cuerpo es el defecto, no la
referencia— y es el único que estas dos anclas registran.

El ancla cubre el título, no la tarjeta entera: el subtítulo de `PageHeader` era `text-[13px]` y
la banda de cuerpo lo llevó a `sm`, o sea 13,5px. Medio píxel, en toda página de administración.

## Cómo se usa

Un titular necesita cuatro decisiones tipográficas. Antes las cuatro estaban sueltas:

```tsx
<h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em] text-ink">
```

Con la escala son dos, y una la resuelve el escalón:

```tsx
<h1 className="text-xl font-extrabold text-ink">
```

La segunda decisión es el peso, y son tres: `semibold` para la interfaz, `bold` para la
microetiqueta, `extrabold` para el titular.
