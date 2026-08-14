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

El login es el primer número que no baja, y es a propósito: el hueco lo produce el centrado de la
tarjeta sobre el eje de la página, que es lo que el dueño pidió expresamente. Bajarlo exige
descentrarla o inventar contenido. Está explicado en su comparación.

La ficha médica del representante es el otro número que **sube**, y por la misma clase de motivo:
se fueron 90px de una tarjeta que repetía dos veces lo que la pantalla ya decía, y el formulario
—ahora en dos columnas— recuperó menos de lo que se quitó. Bajarlo pedía dejar la repetición o
inventar un dato que el backend no guarda. Está explicado en su comparación, con el documento
midiendo 900px antes y después.

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

Ya no queda nada medido sin tocar. Lo que sigue en la fase 4 son las pantallas del entrenador y las
del admin, que todavía no tienen medición.

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

---

## El orden del plan

| Fase | Qué | Estado |
|---|---|---|
| F1 | Fundación: tokens, tipografía, primitivas, riel | ✅ |
| F2 | La landing renovada — la trabaja Alejandro. **Espera el OK del cliente** | pendiente |
| F3 | Tres faros: Miembros · Inscripción · Login y Perfil | ✅ 3 de 3 |
| F4 · tanda 1 | El socio: Mi cuenta · Ficha médica · Mis pagos | ✅ |
| F4 · tanda 2 | El entrenador | pendiente |
| F4 · tanda 3 | El admin | pendiente |

Los faros están elegidos por contraste, no por importancia: una tabla densa, un formulario largo y
la cara al socio. Si el sistema aguanta esos tres, aguanta los que siguen.

**La demo al cliente dejó de ser compuerta** (14/08/2026). El cliente ya dio por bueno el sistema y
su única acotación fue la landing, así que la calidad del producto la decide Alejandro y el barrido
no espera aprobación externa. **La landing es la única que sí la necesita antes de entregarse.**
