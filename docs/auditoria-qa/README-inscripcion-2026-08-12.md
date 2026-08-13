# QA del registro de cuentas — 12 de agosto de 2026

## Alcance

El alta pública de cuenta: el recorrido al que llega un visitante que hace clic
en **«Inscríbase»** desde `/login`. Eso es `/student/enroll`, un asistente de
cuatro o cinco pasos según el tipo de inscripción.

No es el alta del panel de administración (`/admin/crear-cuenta`), que es otro
formulario, con otras reglas y otro dueño. Ese quedó fuera.

## Método

Suite Playwright determinista: `frontend/tests/e2e/enroll-qa.spec.ts`.

- **80 casos, 80 verdes**, 81 capturas en `docs/auditoria-qa/img-inscripcion-2026-08-12/`.
- Cada caso entra **desde el login y clickeando «Inscríbase»**, no navegando a
  la URL. Si ese enlace se rompe, el flujo es inalcanzable para un visitante y
  ningún test de la página sola lo notaría.
- Todo `/api/*` está interceptado a nivel de red. Esto certifica la compuerta
  del frontend y la traducción de errores del servidor; **no** certifica la
  unicidad real de una cédula en la base.
- Las fechas de prueba se calculan contra el año en curso, nunca literales: una
  fecha fija como `1996-05-20` cruza sola el límite de 18 o el de 74 con solo
  dejar pasar los años, y convierte la suite en una bomba de tiempo.

Para correrla:

```bash
cd frontend && npx playwright test enroll-qa.spec.ts
```

## Cómo valida este asistente

Esto explica la forma de casi todos los casos, así que conviene tenerlo antes
de leer la tabla. El asistente **no valida al enviar: valida mientras se
escribe**. Cada paso calcula sus errores por campo, **deshabilita «Siguiente»**
mientras quede alguno, y en `nextBlockedReason` nombra los campos que faltan.
El mensaje concreto aparece **al lado del campo**, pero solo después de que el
campo fue tocado — un formulario en blanco no es un muro de rojo.

Es un buen modelo. Los hallazgos de abajo son, casi todos, lugares donde ese
modelo tiene un agujero.

## Verificación contra el backend

Antes de asignar severidades se mandaron los payloads exactos que el formulario
deja pasar contra el **servicio real** de inscripción
(`EnrollmentServicio.enroll`), no contra un mock. Resultado:

| Caso | Respuesta del backend |
|---|---|
| Fecha futura (dependiente) | RECHAZADO — «debe estar entre 5 y 74 años (calculado: **-2**)» |
| Fecha futura (autoinscripción) | RECHAZADO — mismo mensaje |
| Edad 120 | RECHAZADO — «(calculado: 119)» |
| Año 1750 | RECHAZADO — «(calculado: 278)» |
| Dependiente de 3 años | RECHAZADO — «(calculado: 2)» |
| **Control:** 5 años exactos | ACEPTADO (correcto) |

El control importa tanto como los rechazos: sin él, una sonda rota devuelve
"todo rechazado" y parece una buena noticia.

**Conclusión: ningún dato malo llega a la base.** Los huecos de fecha y edad son
defectos de **experiencia**, no de integridad. Eso baja la severidad de todos
ellos — que es exactamente por lo que se hizo esta verificación antes de abrir
los issues.

> Una trampa que casi arruina esta medición: la suite del backend **congela
> «hoy» en 2029-01-01** (`FECHA_CONGELADA_HOY` en `conftest.py`). El primer
> intento ancló las fechas al calendario real y corrió cada caso 3 años: el
> "dependiente de 3 años" era en verdad de 5 —justo el mínimo— y entró
> correctamente, lo que se leía como un hueco del backend que no existe.

## Veredicto

**No hay bloqueantes, y ninguno es de integridad de datos.** Las reglas
declaradas se cumplen sin excepción: los 47 casos de validación de campo dieron
exactamente el mensaje esperado, los bordes de edad (18 exactos, 17 años y 11
meses, 74, 80) caen del lado correcto, y ningún error del servidor —500, 422,
caída de red— filtra texto interno a la pantalla.

Lo que apareció son **diez huecos que se reducen a cuatro causas raíz**. Y la
principal, ya con la verificación en la mano, se puede enunciar en una línea:

> **El backend tiene UNA regla para el alumno —`5 ≤ edad ≤ 74`— y el formulario
> público no implementa casi nada de ella.**

Cinco de los diez hallazgos son esa sola ausencia, vista desde cinco ángulos.

Lo que lo vuelve un defecto y no una decisión de diseño: **los otros dos
asistentes del mismo repo sí la implementan.**
`add-dependent-utils.ts` tiene `EDAD_MINIMA_ALUMNO = 5`, `EDAD_MAXIMA_ALUMNO = 74`
y un `isFutureDate` explícito; `crear-cuenta-utils.ts` tiene las mismas dos
constantes. La regla ya está escrita dos veces en el código — solo que no en el
formulario por el que entra el público.

## Hallazgos

Cada uno tiene su caso en la suite y su captura. Los casos `G*` afirman el
comportamiento **tal cual es hoy**: si mañana se cierra el hueco, el test se
pone rojo y obliga a actualizar este informe.

| ID | Severidad | Causa raíz | Hallazgo | Captura |
|---|---|---|---|---|
| G02 | Media | **A** | Fecha **futura** en un dependiente pasa sin una queja | `G02-dependiente-fecha-futura-aceptada.png` |
| G01 | Media | **A** | Fecha **futura** en autoinscripción: rechazada con el mensaje equivocado | `G01-fecha-futura-mensaje-equivocado.png` |
| G08 | Media | **A** | Un dependiente de **3 años** pasa el formulario entero | `G08-dependiente-menor-de-5-aceptado.png` |
| G03 | Media | **A** | **Sin techo de edad** para autoinscribirse: 120 años avanza | `G03-sin-techo-de-edad-jugador.png` |
| G04 | Baja | **A** | El año 1750 que el representante rechaza, el jugador lo acepta | `G04-jugador-anio-1750-aceptado.png` |
| G05 | Media | **B** | El **11º dígito de la cédula desaparece** sin decir nada | `G05-cedula-11o-digito-descartado.png` |
| G06 | Baja | **C** | Credenciales a medias: «Siguiente» habilitado, falla al clickear | `G06a-…`, `G06b-…` |
| M01 | Baja | **D** | El mismo error se muestra en toast y en alerta a la vez | `M01-mensaje-duplicado-toast-y-alerta.png` |
| M02 | Baja | **D** | El toast tapa los botones «Corregir» del resumen | `M02-toast-tapa-boton-corregir.png` |
| G07 | — | — | Un nombre de solo espacios se rechaza como vacío (correcto, no es hallazgo) | `G07-nombres-solo-espacios.png` |

**Causa raíz A** — el formulario público no aplica las cotas de edad del alumno
(`5 ≤ edad ≤ 74`) ni rechaza fechas futuras. Cinco síntomas, un solo arreglo.
**Causa raíz B** — `maxLength` recorta en el input en lugar de validar.
**Causa raíz D** — el mismo mensaje se emite por dos canales, y el flotante tapa un control.
**Causa raíz C** — una regla es de paso y no de campo, y rompe el modelo de
prevención de errores del resto del asistente.

### G01 · La fecha futura se rechaza por el motivo equivocado

No existe regla de «fecha futura». Al cargar `2027-06-15` el asistente calcula
la edad, le da un número negativo, y como es menor que 18 dispara la regla de
mayoría de edad. El visitante lee **«Los menores de edad no pueden
autoinscribirse»** sobre una persona que todavía no nació.

La captura lo muestra sin ambigüedad: en pantalla se lee **«Edad calculada: −1
años»**. Una edad negativa mostrada al usuario.

Queda bloqueado, sí. Pero por accidente, y con un mensaje que manda al visitante
a resolver el problema equivocado.

### G02 · La misma fecha futura, en un dependiente, entra

Es la contracara exacta de G01, y el síntoma más visible de la causa raíz A.

La regla de edad del estudiante **solo corre para la autoinscripción**. En una
inscripción de hijo o dependiente, a la fecha de nacimiento no se le mira nada
más allá de que sea un día real del calendario. Un alumno con fecha de
nacimiento del **año que viene** avanza al paso siguiente con «Siguiente»
habilitado y sin un solo mensaje.

La captura es la evidencia más clara de todo este informe. Se ve, a la vez:

- fecha de nacimiento `15/06/2027`,
- **«Edad calculada: −1 años»**, y —esto es lo importante— en la caja **gris
  neutra**, sin el color de advertencia que sí aparece en el caso de
  autoinscripción (G01, donde el mismo dato se muestra en naranja con
  «requieren un representante»),
- y **«Siguiente» en rojo, habilitado**.

O sea: la aplicación **calculó** la edad negativa, **la mostró en pantalla**, y
la trató como un dato normal.

Que en G01 la validación acierte por accidente y en G02 no exista es la misma
ausencia: **falta una regla de fecha futura**, y donde la regla de edad no la
tapa por casualidad, el dato entra.

### G08 · Un dependiente de 3 años pasa el formulario entero

Este apareció recién al probar contra el backend, y es el que mejor muestra el
costo de la causa raíz A.

El backend exige **5 años como mínimo** para el alumno. El formulario público no
conoce ese piso: un dependiente de 3 años avanza el paso, y sigue avanzando los
tres pasos siguientes —representante, salud, resumen— hasta que confirma. Recién
ahí el backend contesta **«La edad del alumno debe estar entre 5 y 74 años
(calculado: 2)»**.

El dato nunca entra a la base. Pero el visitante llenó un formulario completo
—incluida la ficha médica— para enterarse al final de algo que se sabía en el
segundo campo. Eso es exactamente lo que el modelo de «deshabilitar Siguiente»
existe para evitar.

Y el detalle que lo vuelve difícil de defender: `add-dependent-utils.ts`, el
asistente hermano, **ya valida esto** con el mensaje correcto y en el campo.

### G03 y G04 · El estudiante no tiene techo de edad; el representante sí

El representante tiene piso **y** techo, 18 a 74, y se afirma en R03, R04 y R05.
El estudiante que se autoinscribe tiene **solo el piso**.

Consecuencia: **la misma persona sería rechazada como representante y aceptada
como jugador**. Un nacimiento en 1750 —el año implausible que la suite usa para
probar el techo del representante— pasa sin problema del lado del jugador.

Vale una aclaración, porque es el mérito de un arreglo anterior: `calculateAge`
ya **no** devuelve `NaN` para años extremos. Devuelve el número real. El techo
del representante lo frena con ese número. El del jugador no lo frena porque
**no existe**, no porque el cálculo falle.

### G05 · El 11º dígito de la cédula se descarta en silencio

`maxLength=10` recorta el exceso dentro del propio input. Al escribir
`17123456789` el campo queda con `1712345678`, **válido**, y sin ningún aviso
de que se comió una tecla.

Es el modo de fallo más silencioso del formulario: el visitante no ve un error,
ve que su última tecla no entró — si es que lo ve. Termina inscribiéndose con
una cédula que no escribió.

### G06 · La única regla que no previene, castiga

Todas las reglas del asistente previenen el error deshabilitando «Siguiente».
Una no: las credenciales opcionales del estudiante dependiente a medio llenar
—solo el correo, o solo la contraseña—. Es regla de paso, no de campo, así que
el botón **invita a avanzar** y recién el clic descubre el bloqueo.

Severidad baja: bloquea correctamente y el mensaje es claro. Pero es la única
inconsistencia del modelo, y el modelo es lo bueno que tiene este formulario.

### G07 · No es un hallazgo

Se incluye porque el caso se probó y el resultado es el correcto: `"     "` se
rechaza como **«Los nombres son obligatorios»**, no como «debe tener al menos 3
caracteres». El `trim()` está antes de medir. Queda registrado para que nadie
tenga que volver a preguntarlo.

## Lo que se probó y está bien

Vale tanto como la lista de hallazgos, porque es lo que no hay que volver a
revisar.

**Entrada y tipo (T1–T3, 3 casos).** El enlace «Inscríbase» del login abre el
alta sin sesión. El tipo por defecto es Jugador, se cambia a Representante, y el
paso de tipo nunca bloquea.

**Datos del estudiante (P01–P23, 23 casos).** Nombres y apellidos: vacío, menos
de 3 caracteres, con dígitos, con símbolos, y tildes y ñ aceptadas. Cédula: 9
dígitos, con letras. Teléfono: 6 dígitos, y **con guiones aceptado** —
`099-123-4567` son 10 dígitos porque los separadores se limpian antes de medir;
es intencional y quedó clavado. Correo: sin arroba, sin dominio de primer nivel,
con espacios. Contraseña: 7 caracteres rechazada, 8 exactos aceptada. Edad: 18
exactos pasa, **17 años y 11 meses no** — el cálculo resta el año que todavía no
se cumplió en lugar de redondear hacia arriba. Y la autoinscripción **salta** el
paso de representante.

**Dependiente (C01–C06, 6 casos).** Credenciales del estudiante vacías: válido,
son opcionales. Un menor dependiente es válido. Y las cuatro formas de llenarlas
a medias dan cada una su mensaje.

**Representante (R01–R10, 10 casos).** Paso en blanco, cédula corta, correo
inválido, contraseña corta, nombres con dígitos. Y los tres bordes de edad: 17
rechazado con **«calculado: 17»**, 80 rechazado con **«calculado: 80»**, 1750
rechazado. El mensaje incluye la edad calculada, que es exactamente lo que un
usuario necesita para entender por qué se le rechazó.

**Salud (H01–H05, 5 casos).** La ficha médica **no** es opcional: tipo de sangre,
contacto y teléfono de emergencia son obligatorios y bloquean. Condiciones,
alergias y observaciones sí son opcionales.

**Resumen y envío (S01–S07, 7 casos).** Sin marcar la casilla de revisión,
confirmar está deshabilitado. El resumen muestra los datos, y **la contraseña
nunca aparece en claro**. Un 409 de cédula duplicada llega al visitante. Un 500
con un traceback de `psycopg2` y un 422 con la lista de errores de FastAPI se
traducen a mensajes legibles **sin filtrar una línea del detalle interno**.
Doble clic en confirmar envía **una sola** inscripción.

**Navegación (N01–N03, 3 casos).** «Atrás» conserva lo cargado, el Atrás del
navegador es el mismo Atrás del asistente, y no se puede saltar a un paso
posterior desde el indicador.

**Robustez (X01–X03, 3 casos).** Si la red se cae al confirmar, hay mensaje y el
botón vuelve a estar disponible: el intento no queda colgado. Un 401 no expulsa
al visitante ni le borra lo cargado. Y «Corregir» desde el resumen vuelve al
paso correcto con los datos puestos.

## Un detalle del contrato que conviene no romper

El BFF de `/api/enrollment/` devuelve **exactamente** `{enrolled: true}`, y el
cliente rechaza cualquier respuesta con una clave de más. No es casualidad: es
para que **ningún token llegue al JavaScript del cliente**. Los tokens viajan
solo en cookies `HttpOnly`.

Se documenta acá porque el primer mock de esta suite devolvía
`{enrolled: true, personaId: 42}` y el cliente lo rechazó, correctamente, con un
502. El defecto era del mock. Quien escriba el próximo test contra este endpoint
se ahorra el rato.

## Identidades ya registradas — verificado de punta a punta

Se sembró una inscripción real y se reintentó por HTTP contra
`POST /api/v1/enrollment/`:

| Caso | Status | Cuerpo |
|---|---|---|
| Cédula de alumno ya registrada | **400** | `Ya existe una cuenta registrada con los datos ingresados.` |
| Cédula de representante ya registrada | **400** | *idéntico* |
| Correo de representante ya registrado | **400** | *idéntico* |
| **Control:** todo nuevo | 201 | alta creada |

Los tres devuelven **exactamente el mismo texto**. Es deliberado y es lo
correcto: distinguirlos convertiría el alta pública en un oráculo para
averiguar si una cédula o un correo están registrados en el club.

En pantalla, ese mensaje llega completo y **con una salida**: la alerta engancha
la ayuda de identidad duplicada —«Si ya se inscribió antes, no necesita volver a
hacerlo» con enlaces a *Iniciar sesión* y *Recuperar contraseña*—. Un error que
solo repite el problema es un callejón sin salida; este no lo es.

### Un mock infiel que casi pasa por bueno

La primera versión del caso `S03` inventaba un **409** y un texto propio
(«La cédula ingresada ya está registrada»). **Pasaba en verde.** El backend real
responde **400** y otro texto.

Un mock infiel no falla: certifica la traducción de una respuesta que el
servidor nunca manda. Es el mismo error que este repo ya pagó una vez con los
mocks de error sin `status`. `S03` ahora usa el status y el texto verificados.

## Qué falta

La pregunta que más importaba —si el backend ataja lo que el formulario deja
pasar— quedó contestada: **sí lo ataja, todo.** La segunda —qué pasa con
identidades ya registradas— también, arriba.

Queda fuera de alcance, y conviene decirlo:

- **El alta del panel de administración** (`/admin/crear-cuenta`). Es otro
  formulario con otras reglas; comparte helpers con este, así que varios
  hallazgos probablemente se repitan ahí, pero no se probó.
- **El asistente de dependientes** (`/student/add-dependent`), por lo mismo.
- **Límite de intentos** en el alta pública. El endpoint es público y no se
  midió cuántas inscripciones seguidas acepta desde un mismo origen.
- **Acceso con teclado y lector de pantalla.** Los errores llevan `aria-invalid`
  y `aria-describedby`, pero no se recorrió el formulario sin mouse.
