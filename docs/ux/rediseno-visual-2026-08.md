# Rediseño visual — decisiones

Reunión con el cliente del **13 de agosto de 2026**. El veredicto, textual: lo funcional
*"espectacular, ayuda mucho"*; lo visual y la facilidad de uso, *"mucho que desear"*. Los cinco
reproches concretos fueron **estilos distintos**, **un botón por acá y otro por allá**, **cosas
desalineadas**, **espacios vacíos** y **perfil genérico, sin creatividad**.

Este documento es el registro de lo decidido. Las veinte decisiones se revisaron una por una sobre
una hoja construida con el propio sistema —cada regla con su ejemplo renderizado— y las veinte
quedaron aprobadas. Acá está lo que se acordó, no cómo se ve: para eso está la hoja.

## Lo que el diagnóstico encontró

No es un problema, son dos, y se arreglan distinto.

| Reproche | Qué es en realidad |
|---|---|
| Perfil genérico, sin creatividad | La marca vive **solo en la landing** y muere en el login. El producto era Inter sobre grises: podía ser cualquier SaaS |
| Botones sueltos, desalineado, espacios vacíos | Pantallas que **nunca se migraron** al kit de primitivas que ya existe |

La app **ya tenía un sistema de diseño serio**: `tailwind.config.ts` declara "La Paleta" —escalera de
superficies `canvas`/`sunken`/`paper`, rampa de tinta, rampa de estados, escala tipográfica de ocho
pasos con contraste medido, anillo de foco que pasa WCAG 1.4.11— y `components/ui` tiene las
primitivas. Nada de eso se tiró. Lo que faltaba arriba de ese sistema era **carácter**, y abajo,
**obediencia** en las pantallas que se saltearon el kit.

La dirección visual sale del artifact **"Cata Club — Landing renovada"**: rojo `#D92128`, amarillo
`#FFD600`, negro `#111111`; **Graduate** display, **Barlow** texto, **Playfair Display** para las
frases con peso; marcos negros con bisel amarillo y tramas halftone.

---

## Parte 1 — La dirección

### D1 · Un sistema, dos intensidades

La marca entra a **todo** el producto con la densidad bajada donde hay datos.

| | Landing | Producto |
|---|---|---|
| Display | Graduate 62px | Graduate 26px (título de página) |
| Rojo | Fondo pleno de sección | Acción y acento |
| Halftone | Sí | Solo en vacíos y en logros |
| Marco negro con bisel | Firma del hero | Una tarjeta destacada por pantalla |

Se conservan la escalera de superficies y todo el contraste medido. La marca se apoya encima.

El vehículo de la marca en el producto es **el caucho**, no el rojo: el negro del club es un neutro
y puede cargar identidad ocho horas por día sin fatigar. De ahí el **hombro de caucho** de la
tarjeta (D7). Descartado el trasplante completo: rojo pleno de fondo en una pantalla de asistencias
cansa a la tercera semana y obliga a rehacer el contraste que hoy está medido.

### D2 · La paleta

Los grises están corridos hacia el violeta a propósito: un gris puro al lado del rojo del club se
ve sucio. La escalera (`canvas` #E8E8EE / `sunken` #F4F4F7 / `paper` #FFFFFF) y las hairlines
(`line` #DEDEE6, `line-2` #CFCFDA) **no se tocan**.

**Corregido en la fundación**: `ball-ink` pasó de `#8A6D00` a `#6E5700`. El valor viejo fallaba AA
en las **dos** superficies que alcanza —3.48:1 sobre el amarillo y 4.03:1 sobre `canvas`— y sólo
cumplía sobre `paper` (4.92:1), que es como sobrevivió sin que nadie lo midiera. El valor nuevo ya
existía como `--ball-ink-strong` en la hoja de prototipos; se promovió y el token local se retiró.

### D3 · La tipografía

**Graduate** display, **Barlow** texto, **Playfair Display** voz. Inter sale. Costo de assets cero:
los tres `.woff2` ya estaban en `public/fonts/`, cargados sólo por la landing.

Tres reglas duras:

- **Graduate** es display en mayúsculas: **nunca** por debajo de 15px y **nunca** dentro de un
  párrafo. Un `<p>` en Graduate es un defecto, no una decisión audaz.
- **Barlow** carga todo el texto de interfaz. Ante la duda, es esta.
- **Playfair** es la voz, racionada: **una frase por pantalla como máximo**.

La escala de ocho pasos no se toca. Cambian las familias, no los tamaños.

### D4 · Los motivos

Cuatro recursos, cada uno con su límite: **marco de caucho con bisel amarillo** (uno por pantalla),
**trama halftone** (sólo en vacíos y en logros, nunca detrás de datos), **antetítulo con guión
rojo** (libre) y **regla roja 64×3** (libre, siempre a la izquierda).

La numeración `01/02/03` **no entra al producto**: en la landing cuenta una secuencia real, en una
tabla de alumnos no cuenta nada.

---

## Parte 2 — Las piezas

### D5 · Botones

**Tres niveles, los tres con superficie propia**, los tres de 40px:

| Nivel | Piel |
|---|---|
| Primaria | Relleno rojo. Una por pantalla |
| Secundaria | `paper` con borde de control |
| Terciaria | Relleno `sunken`, sin borde |

La variante **fantasma se borra del sistema**. No alcanza con arreglarla pantalla por pantalla:
mientras exista como variante del botón compartido vuelve a aparecer (hoy tiene 10 usos en 5
pantallas, más `.btn-ghost` en la hoja global).

Y una cuarta cosa que **no es botón**: el **enlace**, para lo que navega. Un enlace disfrazado de
botón es lo que hace que una pantalla tenga cinco cosas iguales que se comportan distinto.

### D6 · Campos y el anillo de foco

Sin cambios: el anillo de dos bandas —2px de `ball` pegado al control, 2px de `coal` alrededor— ya
existe y ya pasa WCAG 1.4.11. Una sola banda no puede: el amarillo mide 1.41:1 sobre `paper`.

### D7 · La tarjeta

**Variante A — hombro de caucho**: barra superior en `coal` con el antetítulo en `ball`, la cifra en
Graduate, y un **pie con punto de estado**. Descartadas la placa con bisel y la red.

Dos reglas que salieron de ver cuatro tarjetas juntas:

- **Regla del hombro** — el hombro de caucho marca **lo que pide acción**, y por eso lo lleva como
  mucho una tarjeta por fila. Si lo llevan las cuatro, no marca nada.
- **Regla de la forma** — la figura toma la forma de lo que mide: una proporción lleva barra, una
  serie lleva tendencia, una agenda se dibuja como lista. Decir "4 sesiones" escondía la única que
  importaba.

Un número solo no dice nada —12 pendientes puede ser una buena o una mala semana—; el pie con el
punto de estado es lo que lo convierte en información.

### D8 · Encabezado y la regla de acciones

La acción **primaria** ya estaba fijada al slot de `PageHeader`, con un test que nombra cada
pantalla que dibuja `AppShell`. El agujero eran las **secundarias**:

> Una primaria en el encabezado, como mucho una secundaria al lado, y **todo lo demás vive al pie
> del bloque que modifica**. Ninguna acción flota en el medio del contenido.

### D9 · La tabla densa

Tres reglas, y las tres valen para todo el producto:

- **Regla del dato** — una columna existe si sirve para **decidir** o para **encontrar**. La cédula
  no hace ninguna de las dos cuando ya está el nombre delante: vive en el buscador y en la ficha,
  **no en la grilla**.
- **Regla del formato** — una columna, un formato, sin excepciones. Los días son siempre **siete
  casillas fijas** en el mismo orden; las horas siempre `17:00` en cifras tabulares; el vacío es
  siempre **—**, nunca "sin horario" en una fila y "-" en la de al lado. El formato lo impone el
  sistema, no el dato.
- **Regla de las palabras** — la interfaz **no abrevia**. Si algo no entra, entra menos información,
  nunca una palabra cortada. Nada de "Rep.", "Cat." ni "Hor.". Y ninguna etiqueta que se deduzca de
  otra: si está el representante, sobra decir "menor".

Única excepción declarada a la regla de las palabras: las siete letras de la franja de días, que
**no son palabras abreviadas sino posiciones de una escala** —se lee el dibujo, no el texto— y
llevan el nombre completo del día para el lector de pantalla.

**Vocabulario.** El producto tenía **tres palabras para la misma persona**: *Jugador* al inscribirse
y al crear la cuenta, *alumno* en la tabla y en las direcciones, *estudiante* en el rol y en la
ruta. Se unifica en **Jugador**, que es la palabra que la persona vio el día que entró al club. La
columna pasa a llamarse **Miembro**, porque también lista gente que no juega. Alcance: cambia lo que
se **ve**; las rutas y los nombres internos son refactor aparte.

La **celda de identidad** —inicial, nombre arriba, roles abajo— es **una pieza compartida**, no un
maquetado suelto: se repite en seis pantallas.

### D10 · Estados

Cuatro estados con su par de color propio, medidos sobre su tinte y sobre el canvas. El número que
fija todo: `warn` sobre `canvas` mide **4.59:1**, el par más ajustado del sistema y la razón por la
que el canvas no puede ser más oscuro que #E8E8EE.

### D11 · El estado vacío

Tres partes obligatorias: **qué falta**, **por qué**, **qué hacer**. Es la única pantalla donde el
producto puede tener personalidad sin estorbar, y ahí sí entra el halftone.

### D11b · El aire muerto, medido

Los "espacios vacíos" del cliente **ya estaban medidos** en el repositorio (issues #265 y #266):

| Pantalla | Aire muerto |
|---|---|
| Ficha médica (estudiante) | **57%** |
| Ficha médica (representante) | 42% |
| Mi cuenta (estudiante) | 38% |
| Pagos (representante) | 34% |
| Mi cuenta (representante) | 33% |
| Pagos (estudiante) | 27% |

Son **dos causas independientes**: el **estado flaco** —el socio nuevo tiene un plan, un horario,
cero pagos y cero asistencias, y eso es frecuente, no un caso borde— y la **proporción de layout**,
que sigue mal aun con datos completos. La ficha médica es layout puro: no crece nunca.

El precedente que no hay que repetir: **el tablero del entrenador se diseñó con un prototipo de
datos abundantes y salió a producción con 250px de aire muerto**. De ahí la regla:

> **Cada pantalla se diseña con el socio nuevo primero.** Cero pagos, cero asistencias, un plan. La
> versión con datos abundantes va después y tiene que seguir funcionando — no al revés.

Y el aire muerto deja de ser una opinión: **se mide antes y después de cada pantalla**, y el número
entra al PR.

### D11c · La ayuda no vive suelta

> El subtítulo de la pantalla dice **qué es** esto, en una línea. Todo lo que explique **cómo
> funciona** va bajo "Ver ayuda". Y ninguna ayuda repite el subtítulo: si lo repite, sobra una de
> las dos.

El componente `ContextualHelp` ya existe y el patrón ya se aplicó en el panel admin. Falta que las
pantallas del socio usen el contrato que el admin ya tiene (issue #264).

### D12 · El riel de navegación

Entra la marca en la cabecera —pelota con las iniciales, nombre en Graduate— y se refuerza el
marcador rojo del ítem activo. Es lo primero que ve el usuario y hoy no dice de quién es.

### D12b · Volver

Había **dos** controles de regreso: una píldora con contorno rojo de 32px en las pantallas internas
y un enlace pelado gris de 24px sobre coal en login. Más cinco etiquetas con cuatro criterios de
mayúsculas.

Queda **uno**: 32px, radio 10, flecha y etiqueta, con dos pieles según el fondo (relleno hundido
sobre claro, blanco al 10% sobre caucho). **La caja se queda** —respeta la decisión previa de que el
control tenga borde visible— y **el rojo se va**: un contorno rojo dice "esto importa" y volver es
el control menos importante de la pantalla.

La etiqueta **deja de escribirse a mano**: el nombre del destino sale del mismo registro que dibuja
el riel. Se sigue prohibiendo el "Volver" pelado, pero la regla ya no depende de que alguien se
acuerde.

### D12c · Confirmar

El diálogo de confirmación ya estaba bien —su "Cancelar" usa la piel secundaria, con caja—. Lo que
cambia:

- **El botón dice lo que hace**, no "Confirmar": *Aprobar pago*, *Rechazar pago*.
- **El rojo va en la acción, nunca en "Cancelar".** Ya se corrigió una vez en el código; queda
  escrito para que no vuelva.

Encontrado y **fuera del rediseño**: el diálogo pone el foco de teclado en confirmar **también
cuando es destructivo** — un Enter de más y el pago queda rechazado. Es comportamiento, va como
issue aparte con su test.

### D12d · Más de un rol

El backend **ya soporta cualquier combinación**: autoriza contra el arreglo completo de roles del
token y existe `RolServicio.asignar_rol`, así que **alumno + entrenador se puede crear hoy**. El
frontend los colapsa a uno solo por precedencia y pinta únicamente ese: a los 18 representantes que
también son jugadores les ofrece "Unirme como jugador" —algo que ya son— y les bloquea su propia
vista.

**El riel es la unión, no un modo.** Suma las secciones que a esa persona le corresponden, con un
rótulo por grupo (*Entrenar* / *Mi cuenta*). **Sin selector de rol**: un selector convierte los
roles en modos y obliga a recordar en cuál estás parado. La distinción que ordena todo:

> **El rol define qué secciones ves. La persona define de quién son los datos.**

Lo segundo ya lo resuelve el selector de persona que el producto tiene. Dos preguntas, dos
controles. La otra mitad —dejar de ofrecer lo que ya se tiene, dejar de bloquear la vista propia— es
comportamiento y va en la issue #269.

---

## Parte 3 — El plan

### D13 · Las fases

Los 33 prototipos HTML **ya se hicieron una vez** y el cliente igual salió de la reunión diciendo lo
que dijo. Esta vez la validación pasa por la app funcionando.

| Fase | Qué |
|---|---|
| **F1** | Fundación — fuentes, tokens de marca, primitivas, `AppShell` |
| **F2** | La landing renovada. **Revisor: el cliente** |
| **F3** | Tres faros en la app real: `/members` (tabla densa), `/student/enroll` (formulario largo), `/login` + `/profile` (la cara al socio) → **demo al cliente** |
| **F4** | El barrido de las 30, en tres tandas: socio, entrenador, admin |

El socio primero: el admin usa la herramienta porque le pagan, el socio la abandona.

### D14 · El contrato y los candados

> **Cambia cómo se ve, no qué hace.**

Ninguna regla de negocio, ningún endpoint, ningún flujo. La suite queda verde en cada PR. Si un test
de comportamiento se pone rojo durante el rediseño, el rediseño está mal, no el test.

Ningún token nuevo entra sin pasar por los tres candados de color:
`lib/__tests__/color-contrast.test.ts`, `components/ui/__tests__/design-tokens.test.ts` y
`lib/__tests__/prototipos-sistema-tokens.test.ts`.

Sobre el tercero: ata `docs/archive/prototypes/prototipos/_sistema.css` a `tailwind.config.ts`, y esa
hoja está archivada. **Se mantiene**, y la hoja sigue al producto en lo que el candado mide —color—.
Lo que el candado **no** mide es la tipografía: la pila `--sans` de la hoja quedó en Inter, histórica
y declarada como tal en su propio comentario, porque estas maquetas se abren como HTML suelto sin las
woff2 del producto. La autoridad tipográfica es `tailwind.config.ts`.

Entrega en **PRs encadenados**: la fundación primero, después uno por pieza o por pantalla. Cada PR
sale visualmente completo; no se mergea una pantalla a medio vestir.

### D15 · Las issues

| Issue | Destino |
|---|---|
| #265 · aire muerto en paneles | **Cerrada** — absorbida en D11b, se ejecuta en F4 |
| #266 · ficha médica | **Cerrada** — absorbida en D11b, se ejecuta en F4 |
| #264 · ContextualHelp | **Cerrada** — absorbida en D11c, se ejecuta en F4 |
| #276 · renovación de la landing | Abierta — F2 |
| #277 · hero con 620px en móvil | Abierta — F2. Causa raíz ya diagnosticada: `flex-basis: 620px` declarado pensando en el ancho, que al apilarse pasa a ser alto |
| #269 · doble rol | Abierta — la forma se decidió en D12d; su mitad de comportamiento va con su test |
| #275 #267 #263 #262 | Fuera del rediseño — backend, documentación y reglas de asistencia |

Las tres cerradas llevan un comentario que dice en qué decisión quedó su contenido y en qué fase se
ejecuta: cerrarlas antes de hacer el trabajo pierde el rastro, y el comentario es lo que lo repone.

Si mañana aparece una issue de interfaz nueva, entra por acá: **no hay dos planes**.
