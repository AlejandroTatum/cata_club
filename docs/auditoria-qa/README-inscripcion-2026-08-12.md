# QA del registro de cuentas — 12 de agosto de 2026

## Estado

**Los seis hallazgos de este informe están cerrados** (issues #224, #225,
#226, #228, #229, #230). `enroll-utils.ts`, `add-dependent-utils.ts` y
`crear-cuenta-utils.ts` pasaron a consumir un único módulo de reglas
compartido (`frontend/src/lib/identity-validation.ts`) y sus copias
divergentes de cédula, teléfono, nombre de persona, edad del alumno y
contraseña se borraron. La suite de abajo (`enroll-qa.spec.ts`) sigue
afirmando el comportamiento exacto de HOY — ya no el de esta fecha — porque
cada caso `G*` y `V*` que documentaba un hueco se dio vuelta para afirmar el
cierre, con el mismo id y la misma captura. El resto de este documento es el
registro histórico de la auditoría original; las secciones que describían el
comportamiento viejo quedan marcadas **Cerrado**.

`M01` y `M02` quedaron explícitamente **fuera** del alcance de ese cableado
(causa raíz D, más abajo) porque no eran una regla de validación de campo.
Se cerraron después, por separado, con #233: `handleConfirm` en
`/student/enroll`, `/student/add-dependent` y `/admin/crear-cuenta` dejó de
llamar `showError` además de `setFormErrors` — el mismo patrón repetido en
los tres asistentes. El error del alta vive ahora solo en la alerta del
paso, sin el toast flotante que se apoyaba encima de los botones «Corregir».

**Adenda (misma fecha) — enmascarado de cédula/teléfono.** Un pase de QA
posterior sobre este mismo informe pidió el tope de la cédula **de vuelta**
("no puede tipear 11") y filtrado de letras en cédula y teléfono, en los tres
asistentes. `G05` y `P09` — los dos casos que afirmaban que once dígitos
entraban sin tope (#225) — se dieron vuelta otra vez para afirmar el nuevo
comportamiento: el 11º dígito no entra, pero el tope ya no es silencioso —
un aviso `aria-live` lo anuncia. La letra que #225 nunca cubrió (una tecla
que no es dígito) tampoco entra, sin aviso, porque nunca fue una entrada
válida. El detalle vive en `frontend/src/lib/numeric-input.ts`.

## Alcance

El alta pública de cuenta: el recorrido al que llega un visitante que hace clic
en **«Inscríbase»** desde `/login`. Eso es `/student/enroll`, un asistente de
cuatro o cinco pasos según el tipo de inscripción.

No es el alta del panel de administración (`/admin/crear-cuenta`), que es otro
formulario, con otras reglas y otro dueño. Ese quedó fuera.

## Método

Suite Playwright determinista: `frontend/tests/e2e/enroll-qa.spec.ts`.

- **81 casos, 81 verdes**, 82 capturas en `docs/auditoria-qa/img-inscripcion-2026-08-12/`.
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
dejaba pasar contra el **servicio real** de inscripción
(`EnrollmentServicio.enroll`), no contra un mock. Resultado:

| Caso | Respuesta del backend |
|---|---|
| Fecha futura (dependiente) | RECHAZADO — «debe estar entre 5 y 74 años (calculado: **-2**)» |
| Fecha futura (autoinscripción) | RECHAZADO — mismo mensaje |
| Edad 120 | RECHAZADO — «(calculado: 119)» |
| Año 1750 | RECHAZADO — «(calculado: 278)» |
| Dependiente de 3 años | RECHAZADO — «(calculado: 2)» |
| **Control:** 5 años exactos | ACEPTADO (correcto) |

El control importaba tanto como los rechazos: sin él, una sonda rota devuelve
"todo rechazado" y parece una buena noticia.

**En ese momento, ningún dato malo llegaba a la base** solo porque el backend
lo frenaba solo; el formulario público no aplicaba ninguna de estas cotas. Los
huecos de fecha y edad eran defectos de **experiencia**, no de integridad —
eso bajó la severidad de todos ellos, y es exactamente por lo que se hizo esta
verificación antes de abrir los issues.

**Cerrado:** el frontend ahora aplica las mismas cotas (`studentBirthDateRule`
en `frontend/src/lib/identity-validation.ts`), así que el visitante ve el
rechazo en el campo donde lo escribió, no tres pasos después al confirmar.

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
principal, ya con la verificación en la mano, se podía enunciar en una línea:

> **El backend tiene UNA regla para el alumno —`5 ≤ edad ≤ 74`— y el formulario
> público no implementaba casi nada de ella.**

Cinco de los diez hallazgos eran esa sola ausencia, vista desde cinco ángulos.

Lo que lo volvía un defecto y no una decisión de diseño: **los otros dos
asistentes del mismo repo sí la implementaban.**
`add-dependent-utils.ts` tenía `EDAD_MINIMA_ALUMNO = 5`, `EDAD_MAXIMA_ALUMNO = 74`
y un `isFutureDate` explícito; `crear-cuenta-utils.ts` tenía las mismas dos
constantes. La regla estaba escrita dos veces en el código — solo que no en el
formulario por el que entra el público.

**Cerrado.** La causa raíz no se volvió a escribir una tercera vez: las tres
copias —incluida la que faltaba— se reemplazaron por un solo import a
`frontend/src/lib/identity-validation.ts`, que trae `EDAD_MINIMA_ALUMNO`,
`EDAD_MAXIMA_ALUMNO` y `studentBirthDateRule` para los tres asistentes.

## Hallazgos

Cada uno tiene su caso en la suite y su captura. Los casos `G*` y `V*` daban
vuelta a **rojo** apenas se cerraba el hueco correspondiente — y se dieron
vuelta, con el mismo id y la misma captura, ahora afirmando el cierre.

| ID | Severidad | Causa raíz | Hallazgo (estado original) | Estado |
|---|---|---|---|---|
| G02 | Media | **A** | Fecha **futura** en un dependiente pasaba sin una queja | **Cerrado** — #224, `G02-dependiente-fecha-futura-rechazada.png` |
| G01 | Media | **A** | Fecha **futura** en autoinscripción: rechazada con el mensaje equivocado | **Cerrado** — #224, `G01-fecha-futura-mensaje-correcto.png` |
| G08 | Media | **A** | Un dependiente de **3 años** pasaba el formulario entero | **Cerrado** — #224, `G08-dependiente-menor-de-5-rechazado.png` |
| G03 | Media | **A** | **Sin techo de edad** para autoinscribirse: 120 años avanzaba | **Cerrado** — #224, `G03-techo-de-edad-jugador-120.png` |
| G04 | Baja | **A** | El año 1750 que el representante rechaza, el jugador lo aceptaba | **Cerrado** — #224, `G04-jugador-anio-1750-rechazado.png` |
| G05 | Media | **B** | El **11º dígito de la cédula desaparecía** sin decir nada | **Cerrado** — #225, `G05-cedula-11o-digito-avisado.png`; el tope volvió por pedido de QA, ahora con aviso `aria-live` (ver adenda arriba) |
| G06 | Baja | **C** | Credenciales a medias: «Siguiente» habilitado, fallaba al clickear | **Cerrado** — #226, `G06a-…`, `G06b-…` |
| V03–V05 | Media | **E** | Cédula validada solo por largo: verificador y provincia no se chequeaban | **Cerrado** — #228, `V03-…`–`V05-…`, control en `V06-…` |
| V01–V02 | Media | **F** | Teléfono aceptaba letras y largos que no existen en Ecuador | **Cerrado** — #229, `V01-…`, `V02-…`; separadores siguen aceptados (`P12`) |
| V07 | Media | **G** | Apellido con guion o apóstrofo (`Pérez-Mora`, `D'Angelo`) se rechazaba siendo real | **Cerrado** — #230, `V07-apellido-con-guion-aceptado.png` |
| V08 | Baja | **G** | Contraseña sin política más allá del largo (`12345678` pasaba) | **Cerrado** — #230, `V08-contrasenia-debil-rechazada.png` |
| M01 | Baja | **D** | El mismo error se muestra en toast y en alerta a la vez | **Cerrado** — #233, `M01-mensaje-duplicado-solo-en-alerta.png` |
| M02 | Baja | **D** | El toast tapa los botones «Corregir» del resumen | **Cerrado** — #233, `M02-sin-toast-boton-corregir-visible.png` |
| G07 | — | — | Un nombre de solo espacios se rechaza como vacío (correcto, no es hallazgo) | Sin cambios — ya era correcto |

**Causa raíz A** — el formulario público no aplicaba las cotas de edad del alumno
(`5 ≤ edad ≤ 74`) ni rechazaba fechas futuras. Cinco síntomas, un solo arreglo:
`studentBirthDateRule` en el módulo compartido.
**Causa raíz B** — `maxLength` recortaba en el input en lugar de validar; se sacó
del input y quedó solo la regla. (Adenda misma fecha: el tope volvió por
pedido explícito de QA, ahora pareado con un aviso — ver la adenda en
«Estado» y en G05.)
**Causa raíz C** — una regla era de paso y no de campo, y rompía el modelo de
prevención de errores del resto del asistente; ahora corre desde
`validateEnrollFields`, igual que las demás.
**Causa raíz D** — el mismo mensaje se emite por dos canales, y el flotante tapa
un control. No era una regla de validación de campo, así que quedó fuera del
alcance de este cableado; se cerró después con #233, sacando la llamada a
`showError` del camino de error de `handleConfirm`.
**Causa raíz E** — la cédula se validaba con `/^\d{10}$/`: solo el largo, sin
provincia ni dígito verificador.
**Causa raíz F** — el teléfono se limpiaba con un `replace(/\D/g, "")` que
borraba letras junto con separadores, y aceptaba largos (7-8 dígitos) que no
existen en la numeración ecuatoriana.
**Causa raíz G** — el patrón de nombre de persona (`/^[A-Za-zÀ-ɏ\s]+$/`) no
admitía guion ni apóstrofo, y la contraseña no tenía más regla que el largo.
Las causas E, F y G compartían el mismo arreglo: las tres reglas duplicadas en
`enroll-utils.ts`, `add-dependent-utils.ts` y `crear-cuenta-utils.ts` se
reemplazaron por el módulo compartido `frontend/src/lib/identity-validation.ts`.

### G01 · La fecha futura se rechaza por el motivo equivocado

**Cerrado — #224.** `studentBirthDateRule` rechaza una fecha futura por SER
futura, con su propio mensaje, antes de calcular ninguna edad.

Lo de abajo describe el comportamiento que había hasta este cableado. No
existía regla de «fecha futura». Al cargar `2027-06-15` el asistente calculaba
la edad, le daba un número negativo, y como era menor que 18 disparaba la regla
de mayoría de edad. El visitante leía **«Los menores de edad no pueden
autoinscribirse»** sobre una persona que todavía no había nacido.

La captura lo muestra sin ambigüedad: en pantalla se lee **«Edad calculada: −1
años»**. Una edad negativa mostrada al usuario.

Queda bloqueado, sí. Pero por accidente, y con un mensaje que manda al visitante
a resolver el problema equivocado.

### G02 · La misma fecha futura, en un dependiente, entra

**Cerrado — #224.** La misma regla ahora corre para los dos tipos de
inscripción; una fecha futura bloquea el paso sea o no autoinscripción.

Lo de abajo describe el comportamiento que había. Es la contracara exacta de G01, y el síntoma más visible de la causa raíz A.

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

**Cerrado — #224.** El piso de 5 años (`EDAD_MINIMA_ALUMNO`) ahora se aplica
también a la autoinscripción y al dependiente por igual, en el campo.

Lo de abajo describe el comportamiento que había. Este apareció recién al probar contra el backend, y es el que mejor muestra el
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

**Cerrado — #224.** El estudiante ahora comparte el mismo techo de 74 años
(`EDAD_MAXIMA_ALUMNO`) que ya tenía el representante — misma persona, mismo
resultado, sea cual sea el rol.

Lo de abajo describe el comportamiento que había. El representante tenía piso **y** techo, 18 a 74, y se afirma en R03, R04 y R05.
El estudiante que se autoinscribe tiene **solo el piso**.

Consecuencia: **la misma persona sería rechazada como representante y aceptada
como jugador**. Un nacimiento en 1750 —el año implausible que la suite usa para
probar el techo del representante— pasa sin problema del lado del jugador.

Vale una aclaración, porque es el mérito de un arreglo anterior: `calculateAge`
ya **no** devuelve `NaN` para años extremos. Devuelve el número real. El techo
del representante lo frena con ese número. El del jugador no lo frena porque
**no existe**, no porque el cálculo falle.

### G05 · El 11º dígito de la cédula se descarta en silencio

**Cerrado — #225.** El `maxLength` se sacó del input; la regla, no el campo,
era la que decía por qué once dígitos no eran una cédula.

Lo de abajo describe el comportamiento que había. `maxLength=10` recortaba el exceso dentro del propio input. Al escribir
`17123456789` el campo quedaba con `1712345678`, **válido** en cuanto al
verificador (no lo era: ver V03), y sin ningún aviso de que se había comido
una tecla.

Es el modo de fallo más silencioso del formulario: el visitante no ve un error,
ve que su última tecla no entró — si es que lo ve. Termina inscribiéndose con
una cédula que no escribió.

**Adenda — el tope volvió, el silencio no.** Un pedido de QA posterior en esta
misma fecha pidió el tope de vuelta explícitamente ("no puede tipear 11"), en
los tres asistentes. El campo vuelve a no dejar entrar el 11º dígito — pero
ahora con un aviso visible y `aria-live="polite"` en el momento exacto en que
se rechaza, y letras (cédula y teléfono) que tampoco entran nunca, ni al
tipear ni al pegar. La diferencia con el bug original no es el tope: es que
ahora nunca es silencioso. Implementado en `frontend/src/lib/numeric-input.ts`
y cableado en `WizardInput` (`frontend/src/components/wizard-fields.tsx`).

### G06 · La única regla que no previene, castiga

**Cerrado — #226.** La regla de credenciales opcionales del estudiante corre
ahora desde `validateEnrollFields`, igual que el resto: es de campo, no de
paso, y ya no es la única inconsistencia del modelo.

Lo de abajo describe el comportamiento que había. Todas las demás reglas del asistente prevenían el error deshabilitando «Siguiente».
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
de 3 caracteres, con dígitos o símbolos rechazados (ahora con el mensaje que
describe el problema, no la regla — #230), y tildes y ñ aceptadas. Cédula: 9
dígitos, con letras, y un 11º dígito que no entra pero ya nunca en silencio —
un aviso `aria-live` lo anuncia en el momento (#225, adenda misma fecha).
Teléfono: 6 dígitos, y **con guiones sigue aceptado** — `099-123-4567` limpia a
10 dígitos por un allowlist explícito de separadores (espacio, guion,
paréntesis), no por un strip ciego de todo lo que no sea dígito (#229). Correo:
sin arroba, sin dominio de primer nivel, con espacios. Contraseña: 7 caracteres
rechazada, y el borde de 8 caracteres exactos ahora se mide con un valor que no
esté en la lista de comunes (`12345678` ya no pasa — ver V08). Edad: 18 exactos
pasa, **17 años y 11 meses no** — el cálculo resta el año que todavía no se
cumplió en lugar de redondear hacia arriba. Y la autoinscripción **salta** el
paso de representante.

**Dependiente (C01–C06, 6 casos).** Credenciales del estudiante vacías: válido,
son opcionales. Un menor dependiente es válido. Y las cuatro formas de llenarlas
a medias dan cada una su mensaje — ahora en el campo, con «Siguiente»
deshabilitado, no recién al clickear (#226).

**Laxitud frente a la norma ecuatoriana (V01–V08, 8 casos).** Cerraba el
capítulo de reglas de identidad reales en vez de solo internamente
consistentes: cédula con dígito verificador módulo 10 y provincia 01-24/30
(#228); teléfono que rechaza letras y solo admite los largos que existen en el
Plan Técnico Fundamental de Numeración de ARCOTEL (#229); apellido con guion o
apóstrofo aceptado y contraseña contra una lista de las más comunes (#230). El
control `V06` confirma que la cédula sigue validando lo que siempre validó
bien (largo).

**Representante (R01–R10, 10 casos).** Paso en blanco, cédula corta, correo
inválido, contraseña corta, nombres con dígitos. Y los tres bordes de edad: 17
rechazado con **«calculado: 17»**, 80 rechazado con **«calculado: 80»**, 1750
rechazado. El mensaje incluye la edad calculada, que es exactamente lo que un
usuario necesita para entender por qué se le rechazó.

**Salud (H01–H05, 5 casos).** La ficha médica **no** es opcional: tipo de sangre,
contacto y teléfono de emergencia son obligatorios y bloquean. Condiciones,
alergias y observaciones sí son opcionales.

**Resumen y envío (S01–S09, 9 casos).** Sin marcar la casilla de revisión,
confirmar está deshabilitado. El resumen muestra los datos, y **la contraseña
nunca aparece en claro**. El **400** de identidad ya registrada llega completo
al visitante, con su salida a *Iniciar sesión* / *Recuperar contraseña*, y sin
decir cuál de los datos está tomado. Un 500 con un traceback de `psycopg2` y un
422 con la lista de errores de FastAPI se traducen a mensajes legibles **sin
filtrar una línea del detalle interno**. Doble clic en confirmar envía **una
sola** inscripción.

**Presentación de los mensajes (M01–M02, 2 casos).** Cerrados con #233: el
error del alta ya no sale por dos canales a la vez. `handleConfirm` deja de
llamar `showError`, así que el mensaje vive solo en la alerta del paso, junto
al botón «Corregir» que pide usar, y ningún toast queda encima de él.

**Navegación (N01–N03, 3 casos).** «Atrás» conserva lo cargado, el Atrás del
navegador es el mismo Atrás del asistente, y no se puede saltar a un paso
posterior desde el indicador.

**Robustez (X01–X04, 4 casos).** Si la red se cae al confirmar, hay mensaje y el
botón vuelve a estar disponible: el intento no queda colgado. Un 401 no expulsa
al visitante ni le borra lo cargado. El 429 del limitador se traduce sin filtrar
su jerga (`X04`, detallado en el apartado del límite de intentos). Y «Corregir»
desde el resumen vuelve al paso correcto con los datos puestos.

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
  formulario con otras reglas; no tiene su propia suite e2e como esta, pero
  ahora comparte el mismo módulo de reglas (`identity-validation.ts`) que este
  asistente, así que los hallazgos de identidad (cédula, teléfono, nombre,
  contraseña) que aquí se cerraron se cerraron ahí también — verificado por
  los tests unitarios de `crear-cuenta-utils.test.ts`, no por e2e.
- **El asistente de dependientes** (`/student/add-dependent`), por lo mismo:
  mismo módulo compartido, mismos cierres, verificados por
  `add-dependent-utils.test.ts`, no por e2e.
- **Acceso con teclado y lector de pantalla.** Los errores llevan `aria-invalid`
  y `aria-describedby`, pero no se recorrió el formulario sin mouse.

## Límite de intentos — el hallazgo más serio del informe

Medido contra el backend real de QA, no mockeado.

**El límite existe y corta donde dice:** `@limiter.limit("10/minute")` sobre
`POST /api/v1/enrollment/`. Diez pedidos pasan, el once devuelve `429`.

**Pero el cubo es global, no por visitante.** Doce pedidos alternando dos
`X-Forwarded-For` distintos agotaron **un solo** cubo de 10:

```
ronda 1  visitanteA=400  visitanteB=400
ronda 2  visitanteA=400  visitanteB=400
ronda 3  visitanteA=400  visitanteB=400
ronda 4  visitanteA=400  visitanteB=400
ronda 5  visitanteA=400  visitanteB=429   <-- cubo COMPARTIDO agotado
ronda 6  visitanteA=429  visitanteB=429
```

La causa está en la topología, no en el número. En producción solo Caddy
publica puertos: el visitante llega al frontend, y el backend lo llama el BFF
**server-side**. El peer TCP del backend es siempre el contenedor del frontend.
Encima, `backendFetch` no reenvía la IP de origen y uvicorn corre sin
`--proxy-headers`, así que aunque llegara se ignoraría.

**Consecuencia: once pedidos por minuto, desde cualquier lado, dejan al club
entero sin poder inscribir a nadie.** Y no aísla al abusador: su tráfico es
indistinguible del legítimo.

No es exclusivo del alta — la misma clave rige `auth_router` (`60/minute`), el
chatbot y los endpoints anónimos de `personas_router`.

Lo que el visitante ve está bien: el traductor contesta **por status**, no por
cuerpo, así que el `{"error": "Rate limit exceeded…"}` de slowapi —que rompe la
convención `{detail, message}` del resto de la API— igual se muestra como
«Demasiados intentos. Espere un momento e intente nuevamente.» (caso `X04`).
Falta el `Retry-After`.

Registrado como issue aparte por ser de infraestructura y no de este formulario.
