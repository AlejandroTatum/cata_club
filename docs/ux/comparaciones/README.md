# Comparaciones del rediseño — índice

Todo lo que hay que mirar para revisar el rediseño, en un solo lugar. Este archivo se actualiza cada
vez que se publica una comparación nueva.

**Lo que hay acá no son maquetas.** Cada comparación son capturas de la aplicación **corriendo**
contra el entorno de QA con el dataset grande, antes y después, con la misma base de datos y el
mismo guión de medición. El código ya está escrito, commiteado y con la suite en verde. Aprobar una
pantalla significa que está hecha; corregirla significa que se corrige sobre lo hecho.

---

## Los enlaces

### 1 · El sistema visual — la hoja de revisión
**https://claude.ai/code/artifact/9586f1e9-34ea-4097-a874-294262ab9de7**

Las veinte decisiones del rediseño, cada una con su ejemplo renderizado y su check. Está construida
con el propio sistema, así que se revisa mirándola. **Estado: las veinte aprobadas.**

Es el documento de referencia: cuando una comparación diga "esto cumple la regla del hombro", la
regla del hombro está explicada ahí con su ejemplo. El registro escrito equivalente vive en
[`../rediseno-visual-2026-08.md`](../rediseno-visual-2026-08.md), y la autoridad que la
herramienta lee es [`../../../DESIGN.md`](../../../DESIGN.md).

### 2 · La landing renovada
**https://claude.ai/code/artifact/59950026-adc9-4057-9a45-7155519819a8**

La trabaja Alejandro aparte. **Revisor: el cliente.** Es la fuente del vocabulario visual del que
sale todo lo demás — el marco de caucho con bisel amarillo, la trama halftone, el antetítulo con
guión, la regla roja. Fase 2 del plan.

### 3 · Faro 1 — Miembros
**https://claude.ai/code/artifact/657e3a40-d5b4-4384-8808-c1b1cc91d9e5**

La tabla densa. Cuatro capturas: con datos y sin resultados, antes y después.
**Estado: revisado.** Salieron dos correcciones —sacar el chip de rol que mostraba un literal, y
aplicar Graduate a los títulos— que están en marcha.

Capturas sueltas en [`capturas/`](capturas/), por si el enlace no está a mano.

### 4 · Faro 2 — Inscripción
**[`inscripcion.html`](inscripcion.html)**

El formulario largo. Doce capturas: los cinco pasos del asistente público y la pantalla de éxito,
antes y después, recorriendo el flujo de representante que es el más largo de los dos.

Lo que cambió: Graduate en los dos títulos que no lo tenían, los siete asteriscos rojos por paso
reemplazados por «(opcional)» en la minoría que sí lo es, el error en `state-bad` sin el halo
translúcido, el enum de tipo de sangre escrito en palabras, la escalera de superficies desinvertida,
cinco radios reducidos a dos, el ritmo a los tres escalones declarados, y una pantalla de éxito que
por fin dice qué sigue en lugar de reservar 75vh para no llenarlos.

Y lo que lo hacía posible: **el id de cada campo dejó de derivarse del texto de su etiqueta**. Eran
145 llamadas del E2E atadas a la copia visible; renombrar una etiqueta las movía en silencio. Con
los ids declarados en `ENROLL_FIELD_TOKEN`, se renombraron once etiquetas y los 81 casos siguen
pasando. **Estado: pendiente de revisión.**

### 5 · Faro 3 — Perfil y Login
**[`perfil-login.html`](perfil-login.html)**

La cara al socio. Cuatro capturas: el perfil de un jugador y el login, antes y después. Es la
primera comparación que vive en el repositorio en vez de en un enlace, construida con los mismos
tokens de [`DESIGN.md`](../../../DESIGN.md) que revisa.

Lo que cambió: el hombro de caucho en lugar de la banda roja que el sistema prohíbe, la membresía
real del club —que el payload ya traía y la pantalla tiraba—, «Jugador» como única palabra para la
misma persona, Playfair estrenándose en el lema y Graduate en los títulos de tarjeta.
**Estado: pendiente de revisión.**

### 6 · Fase 4 · Tanda 1 — El socio
**[`socio.html`](socio.html)**

Las tres pantallas que el socio abre todos los días: `/student`, `/student/medical-record` y
`/student/payments`. Dieciséis capturas: ocho estados —tres de Mi cuenta, dos de Ficha médica y tres
de Mis pagos— antes y después, en los dos roles y con el socio nuevo aparte, que es el estado que
D11b manda diseñar primero.

**La causa raíz de las tres era una sola.** `AppShell` estira `<main>` al alto de la ventana y
ningún hijo de primer nivel de estas pantallas reclamaba ese alto, así que todo lo que el contenido
no usaba se apilaba debajo del último bloque. En `/student` eso dejaba **tres mecanismos ya escritos
y los tres inertes** —dos `flex-1` y un `mt-auto`— que un comentario daba por funcionando y un test
por probados.

Lo que cambió: la grilla reclama el sobrante y el riel se estira dentro de ella (el carnet no, que es
la reversión del fix 12b y sigue fijada por su test); «Cómo se registra un pago» y la nota del
selector de estudiante detrás de «Ver ayuda»; la ficha médica y los pagos a `measure="short"`; el
editor de ficha médica en dos columnas con un solo encabezado en vez de tres; y los dos estados
vacíos que no tenían salida, con la suya. **Estado: pendiente de revisión.**

### 7 · Fase 4 · Tanda 2 — El entrenador
**[`entrenador.html`](entrenador.html)**

Las tres pantallas del entrenador: `/trainer`, `/trainer/attendance` y `/trainer/attendance/history`.
Veinte capturas: diez estados —tres de Mi día, cinco del asistente de lista y dos del historial—
antes y después, con el reloj del navegador fijado por toma para que los dos lados describan el
mismo minuto.

**Es la primera tanda sin diagnóstico previo**: no hay issue que la haya medido, así que la lista de
ocho hallazgos salió de leer las pantallas contra [`DESIGN.md`](../../../DESIGN.md) y sus nueve
reglas con nombre. Y es la primera cuyo problema **no era el aire vertical**: Mi día, el historial
con datos y la lista de dieciséis alumnos scrollean, así que su hueco al pie medía 0-2% antes y
después. Lo que estaba mal era el ancho, la lectura y el vocabulario.

Lo que cambió: el domingo dejó de ser una pantalla muda —el estado flaco de esta pantalla no es un
socio nuevo, es un día sin entrenamientos—; «Empieza en 700 minutos» pasó a ser la hora de la sesión
en Graduate con la espera dicha en palabras; las cuatro insignias de color del historial pasaron a
ser la misma barra proporcional que «Mi día» ya usaba, con lo que la composición de una sesión dejó
de tener cuatro dibujos y dos paletas; el asistente recuperó el ancho que `mx-auto` sobre un ítem
flex le venía cancelando (364px → 768px); la leyenda permanente del listado se fue detrás de «Ver
ayuda»; y el recibo quedó con **un** solo control de volver, que es la deuda que estaba anotada.
**Estado: pendiente de revisión.**

### 8 · Fase 4 · Tanda 3 — El admin
**[`admin.html`](admin.html)**

Las seis pantallas del panel de gestión: `/dashboard`, `/payments`, `/groups`, `/attendance`,
`/discounts` y `/reports`. Catorce capturas: ocho estados antes y después.

**Es la tanda que cierra el barrido**, y la que más cuidado pedía: `/payments` mueve dinero real, así
que el checkpoint de aprobación en lote, los endpoints y las validaciones quedaron intactos y lo
único que cambió ahí es color, tipografía y dónde vive la ayuda. El diagnóstico se armó leyendo las
seis contra [`DESIGN.md`](../../../DESIGN.md), como el del entrenador.

Lo que cambió: los **quince botones rojos** de la cola de pagos pasaron a secundaria —diez en una
columna dejan de decir «esto es lo único que hay que apretar»—; `/discounts` bajó su **62% de aire
muerto**, el peor número del rediseño, soltando el riel que reservaba 340px al lado de un catálogo
vacío y anclando el «Ver ayuda» que la tanda de miembros había dejado flotando; los días de
`/groups` pasaron de cápsulas de largo variable con la palabra cortada a la **franja de siete
casillas**, que estaba escrita, testeada y sin un solo consumidor; las dos proporciones y la serie
del panel tomaron la forma de lo que miden —y la serie ya estaba calculada y se tiraba—; el panel de
filtros de `/attendance` dejó de gastar 254px en una columna con la mitad derecha vacía; los cuatro
estados vacíos de `/reports` recibieron la salida que nombraban en prosa; y ningún título de tarjeta
seguía fuera de Graduate. **Estado: pendiente de revisión.**

Cierra además la deuda anotada de `Button.test.tsx` —que nunca midió la variante `onCoal` porque sus
listas estaban escritas a mano— y con ella un tercer radio de 8px que vivía en el botón compacto de
todo el producto; y declara la **paleta de gráfico** en `DESIGN.md` y su sidecar, que era la deuda
que la tanda del entrenador dejó apuntada para acá.

### 9 · Fase 4 · La tanda final — las siete que faltaban
**[`final.html`](final.html)**

Las siete pantallas que quedaban, y con ellas se cierra el producto: `/admin/crear-cuenta`,
`/student/attendance`, `/student/add-dependent`, `/ayuda`, `/forgot-password`, `/reset-password` y
`/unauthorized`. Veintiocho capturas: catorce estados antes y después. Como las dos tandas
anteriores, ninguna tenía issue que la midiera, así que el diagnóstico se armó leyéndolas contra
[`DESIGN.md`](../../../DESIGN.md).

**Dos de las siete son credenciales**, así que ahí la consigna vale doble: el contrato
anti-enumeración, la política de contraseña y la lista de reglas en vivo quedaron intactos, y lo
único que cambió es de qué color son dos bordes, con qué receta se dibujan dos enlaces y cuántas
veces se nombra un mismo destino.

Lo que cambió: la asistencia del socio nuevo bajó su **48% de aire muerto** —el segundo número más
grande del rediseño— soltando el riel que no tenía nada que contar y dejando que el registro
reclamara el alto; `/reset-password` dejó de ofrecer **el mismo destino dos veces con dos nombres a
sesenta píxeles**; las cuatro tarjetas de tipo de cuenta dejaron de dibujar su selección en el rojo
que una de ellas ya usaba como identidad; el asterisco rojo retirado se fue del único paso donde
seguía vivo, al lado de los «(opcional)» que lo habían reemplazado; los cinco «p. ej.» pasaron a la
palabra entera; **el id de cada campo dejó de derivarse del texto de su etiqueta** en los dos
asistentes que faltaban, con el patrón del faro 2; y la pantalla de éxito del alta dejó de reservar
75vh con un botón que en realidad navegaba. **Estado: pendiente de revisión.**

Cierra además **doce cadenas de texto por debajo de AA** —cuatro de ellas bajo 3:1— con un candado
nuevo, `lib/__tests__/ink-ramp-usage.test.ts`, que prohíbe apagar la tinta con un alfa en lugar de
nombrar un escalón de la rampa; y con él, once cadenas más en seis archivos compartidos que estaban
en el mismo estado, incluido el *placeholder* de `.input-field` a 2.09:1.

---

## Las mediciones

El aire muerto es el reproche del cliente ("espacios vacíos"), y las issues #265 y #266 ya lo habían
cuantificado antes de que empezáramos. Se mide siempre igual, con el mismo guión: la distancia entre
el borde inferior del contenido más bajo y el fondo de la ventana, dividida por el alto de la
ventana, a 1440×900. Es el hueco que la persona ve vacío sin scrollear.

| Pantalla | Estado | Antes | Después |
|---|---|---|---|
| Miembros | Con datos (45 filas) | 0% | 0% |
| Miembros | Sin resultados | 25% · 227px | **15% · 139px** |
| Perfil | Jugador con membresía | 12% · 105px | **10% · 91px** |
| Login | Formulario en reposo | 23% · 205px | 23% · 208px |
| Inscripción | Paso 1 · Tipo | 21% · 193px | 27% · 244px |
| Inscripción | Paso 2 · Estudiante | 0% | 0% |
| Inscripción | Paso 3 · Representante | 11% · 99px | **7% · 59px** |
| Inscripción | Paso 4 · Salud | 13% · 121px | **11% · 97px** |
| Inscripción | Paso 5 · Resumen | 0% | 0% · 1px |
| Inscripción | Pantalla de éxito | 44% · 393px | **28% · 253px** |
| Mi cuenta | Jugadora adulta con horario | 38% · 344px | **5% · 49px** |
| Mi cuenta | Representante, hijo con datos | 7% · 64px | **5% · 46px** |
| Mi cuenta | Socio nuevo, cero pagos | 26% · 231px | **5% · 49px** |
| Ficha médica | Jugadora adulta | 52% · 469px | **45% · 409px** |
| Ficha médica | Representante | 33% · 301px | 39% · 349px |
| Mis pagos | Jugadora adulta, un pago | 30% · 266px | **25% · 222px** |
| Mis pagos | Representante, un pago | 23% · 206px | **18% · 162px** |
| Mis pagos | Socio nuevo, cero pagos | 17% · 154px | **7% · 64px** |
| Mi día | Sesión en curso (15:10) | 2% · 21px | 2% · 18px |
| Mi día | Madrugada (03:20) | 2% · 21px | 2% · 18px |
| Mi día | Domingo sin sesiones | 2% · 21px | 2% · 18px |
| Pasar lista | Paso 1 · elegir horario | 26% · 234px | **24% · 214px** |
| Pasar lista | Paso 2 · lista de 16 alumnos | 0% | 0% |
| Pasar lista | Paso 2 · filtro sin coincidencias | 9% · 84px | **2% · 20px** |
| Pasar lista | Paso 3 · confirmar | 23% · 208px | **22% · 201px** |
| Pasar lista | Recibo de la sesión archivada | 17% · 156px | 18% · 161px |
| Historial | Este mes (10 sesiones) | 0% | 0% |
| Historial | Período vacío (junio) | 14% · 122px | 14% · 122px |
| Panel de Control | Con datos | 14% · 122px | **12% · 107px** |
| Membresías y Pagos | Cola pendiente (15) | 0% | 0% |
| Membresías y Pagos | Búsqueda sin coincidencias | 44% · 397px | **25% · 229px** |
| Horarios | Cinco categorías | 34% · 308px | 35% · 316px |
| Asistencias | Este mes (218 registros) | 0% | 0% |
| Descuentos | Catálogo vacío | 62% · 555px | **38% · 340px** |
| Reportes | Este mes (87 personas) | 0% | 0% |
| Reportes | Rango sin datos (enero 2019) | 22% · 194px | **15% · 137px** |
| Crear cuenta | Paso 1 · Tipo | 29% · 263px | **19% · 173px** |
| Crear cuenta | Paso 3 · Salud | 5% · 47px | **0%** |
| Crear cuenta | Paso 5 · Resumen | 0% | 0% · 4px |
| Agregar dependiente | Paso 1 · Datos | 5% · 43px | **4% · 38px** |
| Agregar dependiente | Paso 3 · Salud | 4% · 33px | **3% · 28px** |
| Agregar dependiente | Paso 4 · Resumen | 3% · 31px | 3% · 31px |
| Asistencias (socio) | Jugador con 24 sesiones | 0% | 0% |
| Asistencias (socio) | Socio nuevo, cero sesiones | 48% · 434px | **4% · 32px** |
| Preguntas frecuentes | Sin sesión | 2% · 14px | **0%** |
| Recuperar contraseña | Formulario en reposo | 23% · 204px | 23% · 204px |
| Recuperar contraseña | Enlace enviado | 24% · 217px | 24% · 217px |
| Elegir contraseña | Formulario con token | 16% · 148px | **16% · 144px** |
| Elegir contraseña | Enlace no válido | 26% · 238px | 26% · 238px |
| Sin permiso | Cuenta sin rol | 34% · 303px | 34% · 303px |

El login es el primer número que no baja, y es a propósito: el hueco lo produce el centrado de la
tarjeta sobre el eje de la página, que es lo que el dueño pidió expresamente. Bajarlo exige
descentrarla o inventar contenido. Está explicado en su comparación.

La ficha médica del representante es el otro número que **sube**, y por la misma clase de motivo:
se fueron 90px de una tarjeta que repetía dos veces lo que la pantalla ya decía, y el formulario
—ahora en dos columnas— recuperó menos de lo que se quitó. Bajarlo pedía dejar la repetición o
inventar un dato que el backend no guarda. Está explicado en su comparación, con el documento
midiendo 900px antes y después.

Las tres pantallas del entrenador son las primeras cuyo problema **no era el aire vertical**, y por
eso sus números casi no se mueven: tres de sus diez estados scrollean (0-2% antes y después) y los
otros son cortos porque preguntan poco. Lo que estaba mal ahí se mide en **ancho** —el asistente
dibujaba una tarjeta de 364px en una columna de 1152, y el resumen del domingo se estiraba a 1148px
alrededor de una dona de 260— y en lectura. El recibo es el tercer número que **sube**, cinco
píxeles, porque su encabezado dejó de ser un segundo titular de 26px en una pantalla que ya tiene el
suyo. Todo está explicado en su comparación.

El paso 1 de la inscripción es el primero que **sube**, y también a propósito. El contenido es el
mismo y el documento mide lo mismo (900px, no scrollea ni antes ni después): lo que pasó es que
ocupa 51px menos, porque la tarjeta bajó de 32px de relleno a los 20px del sistema y las tres
separaciones escritas a mano pasaron al escalón de página. Bajar el porcentaje pedía dejar el
relleno inflado o inventar un dato en un paso que hace una sola pregunta. Los otros cuatro pasos que
scrollean suman **294px menos** de alto de documento.

### Lo ya medido que todavía no se tocó

De las issues #265 y #266, absorbidas por el plan y cerradas:

| Pantalla | Como estudiante | Como representante | Estado |
|---|---|---|---|
| Ficha médica | 57% → **45%** | 42% → 39% | ✅ [`socio.html`](socio.html) |
| Mi cuenta | 38% → **5%** | 33% → **5%** | ✅ [`socio.html`](socio.html) |
| Mis pagos | 27% → **25%** | 34% → **18%** | ✅ [`socio.html`](socio.html) |

**Las tres están hechas.** Los números de la izquierda son los de las issues; los de la derecha, los
que dio el dataset de QA hoy con el mismo guión. No coinciden exactamente porque el aire muerto
depende de cuántos datos tenga la cuenta que se mire — los pares antes/después que valen para juzgar
el cambio son los de la tabla de arriba, porque los dos lados salieron de la misma cuenta y el mismo
minuto. La ficha médica es la única que no cierra, y es la única de las tres que es layout puro: no
crece con datos porque no hay datos que la hagan crecer.

Ya no queda nada medido sin tocar, y con la tanda del admin **ya no queda nada sin medir**: las seis
pantallas del panel de gestión tampoco tenían issue que las cuantificara, así que su diagnóstico se
armó leyéndolas contra `DESIGN.md`, igual que el del entrenador, y está en
[`admin.html`](admin.html) con su lista priorizada de doce hallazgos. Lo mismo vale para las siete
de la tanda final, con su lista de catorce en [`final.html`](final.html).

La asistencia del socio nuevo es el **48%** con el que arrancó la tanda final y el segundo número
más grande de todo el rediseño. El 4% de la derecha **no cuenta toda la historia y su comparación lo
dice**: el sobrante entró a la superficie en lugar de desaparecer, así que la tarjeta mide ahora
unos 600px de los que cerca de 460 son blanco dentro del borde. Es la misma contrapartida que
`/members` y `/student/payments` ya midieron sobre este movimiento. Las dos alternativas están
descartadas con su motivo: no estirar deja **53%** de lienzo desnudo —peor que el 48% de partida— y
lo único que llenaría el hueco con contenido verdadero es el horario semanal del alumno, que esa
pantalla tiene prohibido mostrar por escrito desde que se creó.

Las cuatro pantallas que **no se mueven** en la tanda final son las tres de credenciales y la de sin
permiso, y por la misma razón que el login: el hueco lo produce el centrado de la tarjeta sobre el
eje de la página. Bajarlo exige descentrarla o inventar contenido, y dos de ellas son además las que
D14 protege más.

Descuentos es el **62%** con el que arrancó esta tanda y el número más grande de todo el rediseño.
El 38% de la derecha subestima la mejora: el guión mide la última **hoja** del árbol, y con la
tarjeta estirada el enunciado queda centrado adentro de ella. Medido sobre el borde inferior de la
última **superficie** —donde termina visualmente la página— el lienzo desnudo va de **455px (51%) a
32px (4%)**. Los dos números están publicados en su comparación; la definición del guión no se
cambió a mitad de la fase porque haría incomparables las nueve pantallas anteriores.

Horarios es el cuarto número que **sube**, ocho píxeles, y por la misma razón que el recibo del
entrenador: lo que se fue fue alto. Las cápsulas de día medían 26px de insignia y la franja de siete
casillas mide 20px, así que las cinco filas terminan más arriba. Lo que esa pantalla ganó no se mide
en el eje vertical, sino en que sus cinco filas por fin se comparan de un vistazo.

---

## Cómo leer una comparación

Cada una tiene la misma estructura:

1. **Las mediciones**, antes y después, por estado.
2. **Con datos** — la pantalla como se usa todos los días.
3. **Sin datos / estado flaco** — el socio nuevo, la búsqueda vacía, el formulario recién abierto.
   Es el estado que peor se ve hoy y el que más se olvida.
4. **Lo que falta** — lo que quedó afuera, con el motivo. Esta sección existe para que ningún
   pendiente se entere por casualidad.

Las decisiones de producto que tuve que tomar en automático —qué dato mostrar, qué palabra usar—
quedan **destacadas** en esa última sección, no enterradas en un párrafo.

Desde la tanda del entrenador hay además un paso 0: **el diagnóstico**, priorizado por gravedad y
con la regla de `DESIGN.md` que rompe cada hallazgo. Las pantallas anteriores lo traían hecho en una
issue; de acá en adelante se arma leyendo la pantalla contra el sistema, y va escrito para poder
discutirse antes de mirar una sola captura.

Una pantalla capturada y **no** modificada también entra a su comparación, con las dos tomas y el
motivo. Es la única forma de distinguir «se miró y estaba bien» de «no se miró»: en la tanda final
son `/forgot-password`, su estado de enlace enviado y `/unauthorized`.

---

## El orden del plan

| Fase | Qué | Estado |
|---|---|---|
| F1 | Fundación: tokens, tipografía, primitivas, riel | ✅ |
| F2 | La landing renovada — la trabaja Alejandro. **Espera el OK del cliente** | pendiente |
| F3 | Tres faros: Miembros · Inscripción · Login y Perfil | ✅ 3 de 3 |
| **F4** | **El barrido de las pantallas del producto** | **✅ completa** |
| F4 · tanda 1 | El socio: Mi cuenta · Ficha médica · Mis pagos | ✅ |
| F4 · tanda 2 | El entrenador: Mi día · Pasar lista · Historial | ✅ |
| F4 · tanda 3 | El admin: Panel · Pagos · Horarios · Asistencias · Descuentos · Reportes | ✅ |
| F4 · tanda final | Crear cuenta · Asistencias del socio · Agregar dependiente · Preguntas frecuentes · Recuperar y elegir contraseña · Sin permiso | ✅ |

**F4 está completa.** Las veinte pantallas del producto pasaron por el sistema, cada una con su
comparación, sus mediciones antes y después y su diagnóstico escrito contra `DESIGN.md`. Lo único
que queda del plan es **F2, la landing**, que la trabaja Alejandro aparte y es la única que
necesita el OK del cliente antes de entregarse.

Los faros están elegidos por contraste, no por importancia: una tabla densa, un formulario largo y
la cara al socio. Si el sistema aguanta esos tres, aguanta los que siguen.

**La demo al cliente dejó de ser compuerta** (14/08/2026). El cliente ya dio por bueno el sistema y
su única acotación fue la landing, así que la calidad del producto la decide Alejandro y el barrido
no espera aprobación externa. **La landing es la única que sí la necesita antes de entregarse.**
