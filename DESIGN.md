---
name: Cata Club
description: Sistema visual del club formativo de tenis de mesa de Loja — la mesa y la red.
colors:
  coal: "#131316"
  coal-2: "#1C1C21"
  coal-3: "#26262C"
  red: "#D92128"
  red-light: "#E55157"
  red-dark: "#A11D22"
  ball: "#FFD600"
  ball-ink: "#6E5700"
  fuchsia: "#E5397D"
  fuchsia-ink: "#9E114F"
  paper: "#FFFFFF"
  sunken: "#F4F4F7"
  canvas: "#E8E8EE"
  line: "#DEDEE6"
  line-2: "#CFCFDA"
  ink: "#17181C"
  ink-2: "#4A4A55"
  ink-3: "#74747F"
  ink-3-strong: "#63636E"
  state-ok: "#137739"
  state-ok-bg: "#E7F4EC"
  state-warn: "#A94D08"
  state-warn-bg: "#FBF0E2"
  state-bad: "#C51B22"
  state-bad-bg: "#FBE9EA"
  state-neutral: "#63636E"
  state-neutral-bg: "#EFEFF2"
  chart-present: "#008300"
  chart-late: "#EDA100"
  chart-justified: "#2A78D6"
  chart-absent: "#E34948"
typography:
  display:
    fontFamily: "Graduate, serif"
    fontSize: "46px"
    fontWeight: 400
    lineHeight: "0.95"
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "Graduate, serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: "1.15"
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Graduate, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: "1.2"
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "Graduate, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: "1.05"
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.45"
    letterSpacing: "-0.01em"
  dense:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "-0.005em"
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 800
    lineHeight: "1.4"
    letterSpacing: "0.12em"
  voice:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "clamp(20px, 2.4vw, 31px)"
    fontWeight: 600
    lineHeight: "1.3"
    letterSpacing: "normal"
rounded:
  card: "14px"
  ctl: "10px"
spacing:
  page: "20px"
  section: "14px"
  field: "7px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.ctl}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.red-dark}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    height: "40px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
  button-tertiary:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.ctl}"
    height: "40px"
    padding: "0 16px"
  button-tertiary-hover:
    backgroundColor: "{colors.line}"
    textColor: "{colors.ink}"
  button-dark:
    backgroundColor: "{colors.coal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.ctl}"
    height: "40px"
    padding: "0 16px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    height: "40px"
    padding: "0 16px"
  badge:
    rounded: "999px"
    height: "26px"
    padding: "0 9px"
    typography: "{typography.label}"
---

# Design System: Cata Club

## Overview

**Creative North Star: "La mesa y la red"**

El sistema se nombra por los dos objetos que definen el deporte del club. La **mesa** es la
superficie de trabajo: plana, ordenada, con líneas que separan sin adornar. La **red** es lo único
que corta esa superficie, y por eso es el recurso que organiza — la regla roja, el hombro de la
tarjeta, el filo de estado de una fila.

De ahí salen dos cosas que en otros sistemas serían arbitrarias. Primero, **el caucho es el
neutro**: el negro del club no es un acento, es el material del que están hechas la raqueta y el
suelo, así que puede cargar la identidad ocho horas por día sin fatigar a nadie — lo que el rojo no
puede. Segundo, **una tabla densa no es un mal necesario**: es la mesa haciendo su trabajo. Este
producto se usa a diario por gente que administra un club real, y la escaneabilidad es la forma que
toma el respeto por su tiempo.

La marca viaja a todo el producto, pero con la densidad bajada donde hay datos. La landing habla
fuerte porque tiene que convencer; una pantalla de asistencias habla bajo porque tiene que servir.
Es el mismo sistema en dos intensidades, no dos sistemas.

**Key Characteristics:**
- Mundo claro y bloqueado: el producto no tiene modo oscuro, y es una decisión, no un pendiente.
- Cada color del sistema pasó por una medición de contraste antes de entrar.
- Tres familias tipográficas con tres trabajos que no se cruzan.
- El acento rojo se raciona; el caucho es el que carga la marca.
- La interfaz no abrevia nunca.

## Colors

Una paleta de club deportivo apoyada sobre grises corridos hacia el violeta: un gris puro al lado de
este rojo se ve sucio, así que el neutro está elegido, no heredado.

### Primary
- **Rojo institucional** (`{colors.red}`): la acción y solo la acción. El botón primario, el filo de
  la fila que necesita atención, la regla que separa bloques, el marcador del ítem activo. Como
  texto se usa su versión oscura (`{colors.red-dark}`), porque el rojo de relleno mide 4.10:1 sobre
  el canvas y no llega a AA.

### Secondary
- **Caucho** (`{colors.coal}`): el material del club. El riel de navegación, el hombro de la tarjeta
  que pide acción, los marcos de firma, la banda exterior del anillo de foco. Sus dos escalones
  (`{colors.coal-2}`, `{colors.coal-3}`) son estados sobre esa misma superficie.

### Tertiary
- **La pelota** (`{colors.ball}`): atención pura, racionada. La banda interior del anillo de foco,
  el antetítulo sobre caucho, el punto de un logro. Sobre ella la tinta es `{colors.ball-ink}`, que
  llega a 4.91:1 — el valor anterior medía 3.48:1 sobre el amarillo y 4.03:1 sobre el canvas, y
  fallaba en los dos lados.
- **Fucsia** (`{colors.fuchsia}`): exclusivo de la landing, para el estado de hover de sus enlaces.
  No entra al producto.

### Neutral
- **La escalera de superficies**: `{colors.canvas}` es el campo de la página, `{colors.sunken}` un
  área hundida dentro de una tarjeta, `{colors.paper}` la tarjeta. Los tres escalones tienen que
  poder distinguirse: el salto de paper sobre canvas es de 7.8 puntos de luminosidad, y es lo que
  hace que una tarjeta se lea como un objeto y no como una hoja con bordes dibujados.
- **Las hairlines**: `{colors.line}` dibuja el borde de una tarjeta y el divisor de una fila;
  `{colors.line-2}` es más firme y es el borde de un control — un botón contorneado en el divisor se
  lee como una celda de tabla, no como algo que se puede apretar.
- **La rampa de tinta**: `{colors.ink}` para el texto principal, `{colors.ink-2}` para el
  secundario, `{colors.ink-3}` para lo apagado **sobre paper**, y `{colors.ink-3-strong}` para lo
  apagado sobre el canvas o sobre un hundido. Son dos tokens porque el mismo gris no sobrevive las
  tres superficies: `ink-3` mide 4.62:1 sobre paper y cae a 3.78:1 sobre el canvas.
- **La rampa de estados**: cuatro pares —correcto, advertencia, neutro, malo—, cada uno con su tinte
  de fondo. La tinta está definida para leerse sobre su propio tinte **y** sobre el canvas, porque
  una insignia a veces cae fuera de una tarjeta.

### La paleta de gráfico

Cuatro colores que **no** salen de la rampa de estados, y la excepción está medida: los tokens de
insignia fallan los chequeos de pares adyacentes para daltonismo y visión normal cuando se ponen
lado a lado en una figura, que es exactamente lo que es un segmento contra sus tres vecinos. Una
insignia es una píldora sola y puede quedarse con la rampa; una dona y una barra proporcional no.

- **Presente** (`{colors.chart-present}`) · **Tardanza** (`{colors.chart-late}`) ·
  **Justificado** (`{colors.chart-justified}`) · **Ausente** (`{colors.chart-absent}`).

El **orden es parte de la paleta**, no una preferencia de quien dibuja: los pares se validaron en
esa secuencia y reordenarlos invalida la medición. Vive en
`app/dashboard/dashboard-utils.ts` como `ATTENDANCE_STATUS_CHART_COLORS`, y hoy la usan la dona del
panel de administración, la barra de composición del entrenador y su asistente de lista — tres
pantallas, una lista de colores. Se valida con el guión de la skill de dataviz:
`node validate_palette.js "#008300,#eda100,#2a78d6,#e34948" --mode light --surface "#FFFFFF"`,
con `--pairs all`.

Estaba fuera de este documento hasta la tanda del admin: era una quinta lista de colores viviendo en
un archivo de utilidades, y la tanda del entrenador la dejó anotada como deuda porque reconciliarla
tocaba la dona del admin. Queda declarada acá, que es donde se busca un color antes de escribirlo.

### Named Rules

**La regla del rojo único.** El rojo es la acción primaria y el estado destructivo. Nunca es un
estado seleccionado, nunca es decoración, y nunca hay dos botones rojos en una pantalla. Un estado
activo se dibuja con caucho más el punto amarillo.

**La regla del par medido.** Ningún color entra al sistema sin su medición de contraste anotada
contra todas las superficies donde puede caer. El número que fija la escalera entera es
`state-warn` sobre `canvas`: 4.59:1. Si alguien oscurece el canvas, ese par es el primero que se
rompe.

## Typography

**Display Font:** Graduate (con serif de respaldo)
**Body Font:** Barlow (con system-ui de respaldo)
**Voice Font:** Playfair Display (con Georgia de respaldo)

**Character:** Graduate es una tipografía colegial de mayúsculas, ancha y plana — trae el gimnasio,
el marcador y la camiseta. Barlow es su contrapeso: una grotesca ligeramente condensada que aguanta
una tabla de doscientas filas sin cansar. Playfair aparece una vez por pantalla, cuando el club
habla en primera persona.

### Hierarchy
- **Display** (`{typography.display}`): el titular de una pantalla de bienvenida o de un hero. Una
  por pantalla, como mucho.
- **Headline** (`{typography.headline}`): el título de página. El tamaño que ya usaba el encabezado.
- **Stat** (`{typography.stat}`): la cifra de una tarjeta de estadística, en cifras tabulares.
- **Title** (`{typography.title}`): el título de una tarjeta o de un diálogo.
- **Body** (`{typography.body}`): la lectura por defecto del producto.
- **Dense** (`{typography.dense}`): celda de tabla, etiqueta de formulario, fila de lista.
- **Label** (`{typography.label}`): mayúsculas de micro-etiqueta — encabezado de columna,
  antetítulo, texto de insignia.
- **Voice** (`{typography.voice}`): la frase que el club le dice a la persona.

Los ocho pasos de tamaño crecen con proporción variable a propósito: abajo son densos porque entre
10 y 15px hay que poder distinguir una etiqueta de un valor de un texto de un vistazo; arriba son
aireados porque un titular solo compite consigo mismo. El tracking sigue al tamaño, porque a 46px un
tracking normal se lee como separación y a 10.5px se lee como mancha.

### Named Rules

**La regla de Graduate.** Es display en mayúsculas: nunca por debajo de 15px y nunca dentro de un
párrafo. Un `<p>` en Graduate es un defecto, no una decisión audaz.

**La regla de la voz.** Playfair aparece **una vez por pantalla**. Una segunda frase en la misma
pantalla significa que ninguna de las dos es énfasis.

**La regla de las palabras.** La interfaz **no abrevia**. Si algo no entra, entra menos información,
nunca una palabra cortada. Nada de "Rep.", "Cat." ni "Admin". Y ninguna etiqueta que se deduzca de
otra: si el representante está nombrado, sobra decir que el jugador es menor. La única excepción son
las siete letras de la franja de semana, que no son palabras abreviadas sino posiciones de una
escala, y que llevan el nombre completo del día para el lector de pantalla.

## Layout

Una pantalla es una columna, y el ritmo vertical tiene **tres escalones y ningún otro**:
`{spacing.page}` entre bloques de primer nivel, `{spacing.section}` entre tarjetas hermanas y entre
las partes de una, `{spacing.field}` entre una etiqueta y lo que etiqueta. Los tres derivan de dos
métricas ya comprometidas: `page` es la mitad del alto de control y `section` es exactamente el
radio de la tarjeta — la calle entre dos tarjetas mide lo mismo que la curva que les recorta las
esquinas.

Las alturas de control también son tokens, no decisiones de quien llama: 40px el control normal,
32px el compacto, 26px una insignia, 60px la fila de una tabla de listado, 56px la fila densa dentro
de una tarjeta, 44px el encabezado de tabla, 116px la tarjeta de estadística.

El shell autenticado es un riel de caucho de 236px, colapsable a 76px, que se vuelve cajón por
debajo de `lg`. El riel agrupa por rol cuando la persona tiene más de uno.

### Named Rules

**La regla de la acción.** Una acción primaria por pantalla, en el encabezado. Como mucho una
secundaria a su lado. **Todo lo demás vive al pie del bloque que modifica.** Ninguna acción flota en
medio del contenido.

**La regla del aire.** Una tarjeta estirada empuja su acción al pie con `margin-top: auto`, para que
el sobrante sea aire deliberado y no un agujero. El aire muerto se mide antes y después de cada
pantalla, y el número entra al PR.

**La regla del estado flaco.** Cada pantalla se diseña primero con el socio nuevo —cero pagos, cero
asistencias, un plan— y después con datos abundantes. En el orden inverso, el tablero del entrenador
salió a producción con 250px de aire muerto.

## Elevation & Depth

El sistema es **tonal antes que proyectado**: la profundidad la hace el escalón de superficie
—canvas, hundido, papel— y la sombra lo refuerza. Cada sombra está teñida con caucho en lugar de
negro puro, para que una tarjeta proyecte el mismo neutro del que está hecho el resto de la paleta,
y todas llevan un desplazamiento vertical real: el juego anterior era un halo casi simétrico del 3 al
4%, que es decoración, no profundidad.

### Shadow Vocabulary
- **soft** (`0 1px 2px rgba(19,19,22,.04), 0 2px 8px -2px rgba(19,19,22,.05)`): el apoyo más leve.
- **card** (`0 1px 2px rgba(19,19,22,.06), 0 4px 10px -3px rgba(19,19,22,.08)`): lo que la capa
  compartida le da automáticamente a toda superficie de papel con radio de tarjeta.
- **elevated** (`0 2px 6px -1px rgba(19,19,22,.08), 0 14px 32px -8px rgba(19,19,22,.16)`): reservada
  para lo que flota sobre la página — modales, popovers, arrastre.
- **hero** (`0 8px 34px rgba(19,19,22,.07)`): una tarjeta sola sobre el canvas sin cromo alrededor.
  Existen exactamente dos en el producto.

### Named Rules

**La regla de la tarjeta.** Radio de tarjeta más superficie de papel **es** una tarjeta, y la sombra
llega sola desde la capa compartida. Pedirle a veinte archivos de pantalla que se acuerden de la
sombra garantiza que la mitad no lo haga.

## Shapes

Dos radios y nada más: `{rounded.card}` para todo lo que es una superficie —tarjeta, panel, diálogo—
y `{rounded.ctl}` para todo lo que es un control —botón, campo, píldora—. Las insignias son cápsulas
completas. La forma dice de qué categoría es la cosa antes de que se lea una palabra.

El anillo de foco es una firma del sistema y no una decisión por componente: **dos bandas
concéntricas**, 2px de pelota pegada al control y 2px de caucho alrededor. Una sola no puede
resolverlo — el amarillo mide 1.41:1 sobre papel y sería decoración, no un indicador; el caucho mide
18.54:1 sobre papel y 15.20:1 sobre canvas. Sobre el riel oscuro los papeles se invierten y el
amarillo es el que carga el contraste, a 13.13:1. Siempre hay una banda que contrasta, esté el
control donde esté.

## Components

### Buttons
- **Shape:** control (`{rounded.ctl}`), 40px de alto, o 32px en su versión compacta.
- **Primary:** relleno rojo, texto blanco. Una por pantalla.
- **Secondary:** papel con borde de control.
- **Tertiary:** relleno hundido, **sin borde**. El tercer nivel se distingue por relleno, no por
  ausencia: tres niveles que sumaran cada uno una línea se diferenciarían solo en cuán oscura es esa
  línea, mientras que relleno contra no-relleno se lee sin comparar.
- **Dark:** caucho, para la acción enfática que no debe ser roja.
- **On coal:** contorno translúcido blanco, para la acción secundaria dentro de una tarjeta de
  caucho.
- **Hover:** cada variante sube un escalón de su propia familia. La terciaria pasa de hundido a
  hairline, que es un escalón fijo y por lo tanto medible.

**No existe un botón fantasma.** Fue retirado del sistema y hay un test que barre el código y falla,
nombrando archivo y línea, si vuelve a aparecer.

### Links
Lo que **navega** no es un botón: es un enlace subrayado en rojo, con flecha cuando apunta a otra
pantalla. Un enlace disfrazado de botón es lo que hace que una pantalla tenga cinco cosas iguales
que se comportan distinto.

### Cards / Containers
- **Corner Style:** radio de tarjeta.
- **Background:** papel, sobre el campo de canvas.
- **Border:** hairline de divisor.
- **Shadow Strategy:** `card`, automática — ver Elevation.
- **Internal Padding:** el escalón de sección o el de página, según la densidad.
- **Signature:** una tarjeta que **pide acción** lleva un **hombro de caucho** — una barra superior
  con su antetítulo en amarillo. Como mucho una por fila: si lo llevan las cuatro, no marca nada.
- Toda tarjeta de dato lleva un **pie con punto de estado**. Un número solo no dice nada: doce
  pendientes puede ser una buena o una mala semana.

### Inputs / Fields
- **Style:** papel, borde de control, radio de control, 40px.
- **Focus:** el borde se oscurece al rojo — el campo reaccionando — y el anillo del sistema hace el
  resto.
- **Error:** borde en el rojo de estado, con el mensaje debajo diciendo qué pasó y cómo arreglarlo.

### Badges
Cápsulas de 26px con la tipografía de etiqueta, un punto de color y su par de tinte. Cuatro estados
y ningún vocabulario paralelo: hubo cuatro familias de insignia en este producto y quedó una.

### Navigation
Riel de caucho con el nombre del club en Graduate y la pelota con las iniciales. El ítem activo
lleva un marcador rojo al filo izquierdo. Cuando una persona tiene más de un rol, el riel **suma** las
secciones con un rótulo por grupo — no hay selector de rol, porque un selector convierte los roles
en modos y obliga a recordar en cuál estás parado.

### Back control
Un solo control de regreso en todo el producto: 32px, radio de control, flecha más etiqueta, con dos
pieles según el fondo. **Tiene caja siempre.** La etiqueta no se escribe a mano: sale del mismo
registro de destinos que dibuja el riel, así que el menú y el botón nombran un lugar de la misma
manera por construcción.

### Identity cell
La pieza que aparece en seis pantallas: inicial, nombre arriba, y abajo **lo que la persona es en el
club** como una lista, porque alguien puede ser jugador y representante a la vez. Nunca nombra una
ausencia.

### Week strip
Siete casillas fijas, siempre las siete, siempre de lunes a domingo, las activas en rojo. Reemplaza
al texto libre, que en una columna producía cuatro largos distintos y hacía imposible comparar dos
filas. Es un `role="img"` cuya etiqueta accesible dice los días en palabras completas.

## Do's and Don'ts

### Do:
- **Do** medir todo par de color nuevo contra las tres superficies antes de escribirlo. Los tres
  candados de test son `color-contrast.test.ts`, `design-tokens.test.ts` y
  `prototipos-sistema-tokens.test.ts`.
- **Do** darle a cada figura la forma de lo que mide: una proporción lleva barra, una serie lleva
  tendencia, una agenda se dibuja como lista.
- **Do** usar un solo formato por columna. Los días son siempre siete casillas, las horas siempre
  cifras tabulares, y el vacío es siempre una raya.
- **Do** poner la ayuda larga detrás de "Ver ayuda". El subtítulo dice **qué es**; todo lo que
  explique **cómo funciona** se guarda.
- **Do** diseñar el estado vacío con sus tres partes: qué falta, por qué, y qué hacer.

### Don't:
- **Don't** dibujar una barra de color al borde de una tarjeta. Es el recurso más repetido de las
  interfaces genéricas y es exactamente el reproche que originó este sistema. La excepción es el filo
  de estado de una **fila**, que codifica estado en forma además de en color.
- **Don't** poner un dato en una grilla si no sirve para **decidir** o para **encontrar**. La cédula
  vive en el buscador y en la ficha, no en la tabla.
- **Don't** inventar un dato para completar una forma. Si el endpoint no trae histórico, no hay
  tendencia que dibujar: la tarjeta se queda callada. Una tarjeta honesta y sobria vale más que una
  linda que miente.
- **Don't** numerar bloques (`01/02/03`) en el producto. En la landing cuentan una secuencia real; en
  una tabla no cuentan nada y son decoración disfrazada de estructura.
- **Don't** poner la trama halftone detrás de datos. Solo va donde no hay nada que leer, o donde hay
  algo que celebrar.
- **Don't** agregar un cuarto vocabulario para algo que ya tiene uno. Este producto llegó a tener
  cuatro familias de insignia, tres nombres para el mismo destino y tres palabras para la misma
  persona.
