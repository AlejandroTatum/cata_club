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

### 4 · Faro 3 — Perfil y Login
**[`perfil-login.html`](perfil-login.html)**

La cara al socio. Cuatro capturas: el perfil de un jugador y el login, antes y después. Es la
primera comparación que vive en el repositorio en vez de en un enlace, construida con los mismos
tokens de [`DESIGN.md`](../../../DESIGN.md) que revisa.

Lo que cambió: el hombro de caucho en lugar de la banda roja que el sistema prohíbe, la membresía
real del club —que el payload ya traía y la pantalla tiraba—, «Jugador» como única palabra para la
misma persona, Playfair estrenándose en el lema y Graduate en los títulos de tarjeta.
**Estado: pendiente de revisión.**

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

El login es el primer número que no baja, y es a propósito: el hueco lo produce el centrado de la
tarjeta sobre el eje de la página, que es lo que el dueño pidió expresamente. Bajarlo exige
descentrarla o inventar contenido. Está explicado en su comparación.

### Lo ya medido que todavía no se tocó

De las issues #265 y #266, absorbidas por el plan y cerradas:

| Pantalla | Como estudiante | Como representante |
|---|---|---|
| Ficha médica | **57%** | 42% |
| Mi cuenta | 38% | 33% |
| Mis pagos | 27% | 34% |

Estas tres son fase 4 y están en la cola del barrido.

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
| F3 | Tres faros: Miembros · Inscripción · Login y Perfil | 2 de 3 |
| F4 | El barrido de las 24 pantallas restantes | pendiente |

Los faros están elegidos por contraste, no por importancia: una tabla densa, un formulario largo y
la cara al socio. Si el sistema aguanta esos tres, aguanta los que siguen.

**La demo al cliente dejó de ser compuerta** (14/08/2026). El cliente ya dio por bueno el sistema y
su única acotación fue la landing, así que la calidad del producto la decide Alejandro y el barrido
no espera aprobación externa. **La landing es la única que sí la necesita antes de entregarse.**
