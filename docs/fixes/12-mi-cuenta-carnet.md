# Fix 12 · Rediseño de «Mi cuenta»: el carnet manda

- **Cierra:** rediseño de `/student` según la Propuesta 2 de las tres maquetas
  presentadas («El carnet manda»)
- **Decisión que lo gobierna:** el dueño eligió la Propuesta 2 después de ver
  las tres, con un problema propio anotado en la maqueta — «pesa mucho cuando
  no hay nada que resolver» — a resolver como parte de la implementación, no
  a ignorar
- **Rama:** `feat/mi-cuenta-carnet`
- **Commits:**
  - `ec20622` — feat(student): make the carnet lead Mi cuenta, weighted by cuota status
  - `a9768d9` — docs(fixes): document the Mi cuenta carnet redesign
  - `6391768` — fix(student): stop the carnet from stretching and the franja splitting
    (corrección 12b, ver más abajo — dos defectos visuales encontrados revisando
    la implementación contra capturas reales)

## El problema

La pantalla de antes abría con una banda de pago a todo lo ancho, seguida de
los próximos entrenamientos en la columna principal y el carnet reducido a
340px en una barra lateral — un adorno, no el motivo de la pantalla. Además,
la banda y el carnet decían prácticamente lo mismo dos veces (el estado de la
membresía por un lado, el estado de la cuota por otro), y ambos pesaban igual
sin importar si había algo que resolver o no: una familia al día veía la
misma pantalla cargada que una familia con la cuota vencida hace dos semanas.

![antes — cuota vencida](img/12-mi-cuenta-antes-vencida-1440x900.png)
![antes — al día](img/12-mi-cuenta-antes-al-dia-1440x900.png)

## Qué se hizo

El carnet pasa a ser la columna ancha de la pantalla (reutilizando
`PAGE_RAIL`, el único patrón de dos columnas del sistema, solo que ahora el
carnet ocupa el lado 1fr en vez del riel de 340px) y lleva el estado de la
cuota como una banda sobre sí mismo, no como una tarjeta aparte. A la derecha,
apiladas: la tarjeta «Cuota» (cubierta hasta, a pagar, el botón) y «Esta
semana» (los próximos entrenamientos, con el más próximo resaltado — la
misma lógica que ya existía, solo renombrada y reubicada).

Debajo del carnet, en un grid fijo de dos columnas (no `auto-fit`: con el
carnet ahora ancho, `auto-fit` habría repartido los datos en cuatro o cinco
columnas en vez de dos), los cuatro datos que pide la maqueta: Socio desde,
Plan, Franja, Valor mensual. "Modalidad" y "Cobertura hasta" salen del
carnet — la primera porque la maqueta no la dibuja, la segunda porque pasa a
la tarjeta Cuota, que es donde vive la fecha de cobertura.

La banda del carnet **reemplaza** la vieja insignia de `Membresia.estado`
("Membresía activa/pendiente/vencida"): las dos podían decir cosas distintas
para el mismo caso (un admin puede marcar una membresía `INACTIVA` sin que
eso diga nada sobre si la cuota está pagada), y la maqueta dibuja una sola
banda. Ahora las dos tarjetas de pago (carnet y «Cuota») leen la misma
`describePaymentSituation` que ya existía — una sola fuente de verdad, nunca
dos redacciones del mismo estado.

Descarté reescribir el carnet sobre `MemberCard` (el componente genérico de
`/profile`): el carnet de `/student` ya es una variante propia, con
documentación extensa sobre por qué cada campo es real y de dónde sale
(`franja` derivada de los horarios asignados, no del plan; sin número de
socio inventado). Fusionarlo con `MemberCard` — que solo conoce
nombre/correo/rol/fecha — habría significado inventarle a `MemberCard` una
API mucho más ancha solo para este caso, sin beneficiar a `/profile`.
Extender el carnet ya existente, en vez de construir uno nuevo, es la lectura
que le doy a «no hagas un carnet paralelo».

### El problema anotado en la maqueta

La dirección elegida: la banda **cambia de peso**, no solo de color.

- **Urgente** (vencida, por vencer, nunca pagada): la banda es una franja
  ancha con ícono, roja, con la cifra que antes lideraba la banda vieja
  (`14 días vencida`).
- **Al día**: la banda se comprime a la píldora pequeña que antes usaba la
  insignia de membresía — un punto verde, una palabra («Al día»).
- **Otros estados sin urgencia** (pago en revisión, menor sin pagos propios,
  sin membresía): mantienen la franja completa pero en tono neutro, porque
  todavía necesitan explicar algo (quién paga, por qué no hay botón) — la
  compresión es específicamente para «no hay nada que resolver», no para
  «no es urgente» en general.

La tarjeta «Cuota» sigue la misma regla: se comprime a una sola línea
(«Cubierta hasta 31/08/2026» + un enlace de texto, sin fila «A pagar» y sin
botón grande) únicamente cuando el estado es `covered`. El espacio que cede
lo toma «Esta semana» de forma natural, sin necesitar redimensionarla a mano.

## Corrección 12b — dos defectos que la primera pasada no vio

La primera versión hacía que el carnet se **estirara** (`lg:!items-stretch`
en el grid de `PAGE_RAIL` más `flex-1` en el propio carnet) para igualar el
alto de la columna derecha (Cuota + Esta semana). La intención era cerrar el
"vacío que no se llena" que tenía la pantalla vieja. El resultado real, visto
en una captura contra datos reales: cuando la columna derecha era más alta
que el contenido del carnet, el carnet crecía igual — y los ~400px de
diferencia quedaban como canvas negro vacío **adentro** del carnet, debajo de
«Franja / Valor mensual». El vacío no desapareció: se mudó de la página al
carnet.

La solución: el carnet **no se estira**. Vuelve a la altura natural,
alineado arriba con la columna derecha (`PAGE_RAIL` sin overrides). Un
carnet tiene proporción de carnet, no de columna — y el margen que queda
debajo, en la columna izquierda, es canvas de página normal (el mismo tipo
de espacio que cualquier columna corta deja), no un hueco dentro de una
tarjeta con borde propio.

El segundo defecto: una «Franja» con dos horarios ("15:00 — 16:00 · 20:00 —
21:15") es una sola cadena en una celda de ~172px, así que el navegador
envolvía la línea donde encontraba un espacio — incluso adentro de un mismo
horario, partiendo "20:00 —" de "21:15" en dos renglones. Un alumno con dos
franjas no es un caso raro (el de la captura está en dos categorías a la
vez), así que había que resolverlo. Cada horario ahora vive en su propio
`<span className="whitespace-nowrap">`; el único punto donde el navegador
puede cortar la línea es el " · " entre dos horarios, nunca adentro de uno.

## El candado

`StudentPage — the carnet earns its space when the cuota is up to date` en
`frontend/src/app/student/__tests__/StudentPage.test.tsx`: los dos casos,
vencida y al día, se comparan por atributos (`data-urgent`, `data-tone`,
`data-compact`) y por contenido (la tarjeta compacta no tiene fila «A pagar»
ni botón grande). Si alguien vuelve a mostrar la misma banda completa para
ambos estados, el test se pone rojo.

```
✓ StudentPage — the carnet earns its space when the cuota is up to date > renders the full-weight strip and the full Cuota card when the cuota is overdue
✓ StudentPage — the carnet earns its space when the cuota is up to date > renders a compact pill and a one-line Cuota card when the cuota is up to date

 Test Files  1 passed (1)
      Tests  37 passed (37)
```

**Candado de la corrección 12b**, mismo archivo:

- `StudentPage — the carnet keeps its own proportions instead of stretching >
  does not force the carnet's height to match the rail's` — el carnet no
  lleva `flex-1` y el grid que lo separa de la columna derecha no lleva
  `items-stretch`. Si alguien reintroduce el estiramiento, el test se pone
  rojo.
- `StudentPage — the carnet's franja agrees with the assigned schedule >
  keeps each window as one unbreakable run so a wrap can never split a time
  in half` — cada horario de una «Franja» con dos ventanas vive en su propio
  `whitespace-nowrap`, y el valor completo sigue leyéndose igual
  ("15:00 — 16:00 · 20:00 — 21:15").

```
✓ StudentPage — the carnet keeps its own proportions instead of stretching > does not force the carnet's height to match the rail's
✓ StudentPage — the carnet's franja agrees with the assigned schedule > keeps each window as one unbreakable run so a wrap can never split a time in half

 Test Files  1 passed (1)
      Tests  39 passed (39)
```

## La prueba

![después — cuota vencida](img/12-mi-cuenta-despues-vencida-1440x900.png)
![después — al día](img/12-mi-cuenta-despues-al-dia-1440x900.png)
![después — cuota vencida, teléfono](img/12-mi-cuenta-despues-vencida-390x844.png)
![después — al día, teléfono](img/12-mi-cuenta-despues-al-dia-390x844.png)

Las cuatro capturas son de la corrección 12b, sacadas contra un backend
propio levantado desde este worktree apuntando a la base de QA compartida
(ver la nota al final). Reemplazan a las de la pasada anterior, que mostraban
el defecto que esta corrección cierra.

Lo que se ve ahora: el carnet termina justo debajo de su grid de datos —
altura natural, sin canvas vacío adentro — y en «cuota vencida» la «Franja»
con dos horarios (15:00 — 16:00 y 20:00 — 21:15) envuelve entre un horario y
el otro, nunca partiendo un horario por la mitad. La banda sigue cambiando de
peso según haya algo que resolver, y en «al día» la tarjeta Cuota se
mantiene comprimida a una línea.

*(Las capturas "representante con 4 hijos" y "alumna autogestionada" de la
pasada anterior no se regeneraron — no estaban en el alcance de esta
corrección — así que se sacaron de esta lista en vez de dejarlas
desactualizadas junto a las cuatro nuevas.)*

### El espacio en blanco — la medición que esta corrección obligó a arreglar

La tabla de "antes/después" de la pasada anterior medía, por cada captura de
1440×900, la fila más baja con contenido real y el porcentaje de canvas
vacío **por debajo** de esa fila — el mismo método que el panel del
entrenador. Con esa vara, el caso «vencida» pasó de 27,2 % a 11,1 %: una
mejora real y bien medida.

Pero el defecto que esta corrección cierra — los ~400px de negro vacío
**adentro** del carnet, entre el grid de datos y el borde inferior de la
tarjeta — no podía aparecer en ese número, por diseño del método: el carnet
tiene contenido arriba de ese hueco (el nombre, la banda, el grid de
"Franja / Valor mensual"), así que "la fila más baja con contenido real" caía
más abajo que el hueco mismo, y todo lo que hay entre el contenido y el borde
de la tarjeta queda fuera de lo que el método mira. El 11,1 % de "después"
convivió con la pantalla de la captura mostrando un rectángulo medio vacío,
y el número no lo contradijo porque nunca pudo verlo.

No reemplazo esa tabla por otra automática: la métrica midió lo fácil de
medir (canvas de página, un problema real y distinto) y no lo que importaba
acá (canvas dentro de un elemento con contenido propio arriba). Fabricar un
segundo número con el mismo apuro que produjo el primero sería repetir el
error con más decimales. La prueba de esta corrección es la captura de
arriba: el carnet termina donde termina su contenido, sin franja negra
sobrante debajo del grid de datos, en los dos estados (vencida y al día) y
en los dos anchos (1440px y 390px) — mirala y comparala con la de la pasada
anterior si hace falta el contraste.

**La lección:** un número que no coincide con lo que se ve es peor que no
tener número. Antes de reusar una métrica para un caso nuevo, hay que
preguntar qué puede y qué no puede ver — no solo si el método ya funcionó en
otra pantalla.

## Lo que NO cambió

- `ManagedStudentPicker` (el selector de estudiante) — intacto.
- `AgeUpConfirmation` y la lógica de qué alumno se muestra — intacta.
- Los dos accesos de siempre (agregar hijo, anotarme como jugador) — mismo
  lugar, mismo comportamiento.
- La ruta BFF (`frontend/src/app/api/student/route.ts`) y su adaptador
  (`student-adapter.ts`) — **no se tocaron**. Ver la nota siguiente.

## Nota — un bug preexistente en el ambiente de QA, no de este fix

Al levantar el `pnpm dev` propio contra el backend de QA, `/api/student`
devolvía 500 para **cualquier** cuenta (antes y después de este cambio):
`TypeError: historial is not iterable` en `student-adapter.ts::buildRecentSessions`.
El backend de QA ahora devuelve `/asistencias/persona/{id}` paginado
(`{items, total, skip, limit}`), y el adaptador en `main` todavía espera un
arreglo plano — un desfase de versión con el ambiente, no algo que este
rediseño causó (rompe la pantalla vieja igual que la nueva).

Apliqué un parche local, **no commiteado**, solo para poder sacar capturas
reales contra QA (`historial = Array.isArray(raw) ? raw : raw.items ?? []`
en `route.ts`), y lo revertí antes de terminar — `git diff` contra
`origin/main` en ese archivo da vacío. No lo dejé en la rama porque es
exactamente el archivo que `fix/rendimiento` está tocando; avisé en vez de
resolverlo.
