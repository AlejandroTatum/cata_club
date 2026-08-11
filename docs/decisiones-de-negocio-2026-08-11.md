# Decisiones de negocio — 11 de agosto de 2026

Tomadas por el dueño del club sobre los hallazgos de la auditoría
(`docs/auditoria-qa/README.md`). Cada una define cómo se implementa su fix.

Lo que está acá **no se re-discute al implementar**. Si algo no cierra durante
el trabajo, se vuelve a este documento y se cambia la decisión con su fecha, no
se resuelve por criterio propio a mitad de camino.

---

## 1 · Un chico tiene un solo representante, y el representante lo vincula solo

**Decisión.** `Persona.representante_id` sigue siendo uno solo. Un representante
puede vincular a su cuenta un chico **ya registrado**, escribiendo su cédula,
**sin que nadie apruebe**.

**Contexto de la decisión.** Se planteó que la vinculación sin verificación abre
un riesgo concreto: la cédula de un menor no es un secreto —está en la
matrícula, la tiene la escuela, la tienen otros padres—, así que quien la
conozca puede quedarse con ese chico en su cuenta y pasar a ver su ficha
médica, sus pagos y sus horarios. Se propuso como alternativa que aprobara el
representante actual (cero carga para el club, diez segundos desde el
teléfono). **El dueño evaluó el riesgo contra su comunidad y decidió igual por
la vía directa.** Queda registrado acá, no para insistir, sino para que la
decisión tenga dueño y fecha si alguna vez hay que revisarla.

**Guardarraíles que sí van** — ninguno agrega un paso al padre:

- La vinculación queda **auditada**: quién vinculó a quién y cuándo.
- Si el chico ya tenía representante, **al anterior le llega el aviso** después
  del hecho, con forma de deshacerlo.
- **La cédula no revela nada antes de confirmar.** Tipear una cédula ajena no
  devuelve el nombre. Sin esto, el formulario es un buscador de datos de
  menores.
- **Tope de intentos**, para que nadie pruebe cédulas en serie.

**Lo que ya estaba resuelto y no hay que construir:** el padre que entrena y
además representa. `REPRESENTANTE` ya otorga los roles `REPRESENTANTE + ALUMNO`
(`admin_cuenta_servicio.py:45`) y el selector de alumno ya contempla incluirse a
sí mismo (`ManagedStudentPicker.tsx:106`). Nunca se vio funcionar porque el seed
crea representantes con cero horarios y cero membresías: está sin ejercitar, no
roto.

**Correos.** Una cuenta = un correo único. La cuenta del menor es **opcional**, y
el backend ya la acepta así (`correo` y `contrasenia` son `Optional` en el
schema). Chico sin correo → sin cuenta, el padre lo ve desde la suya. Chico con
correo → cuenta propia. Si el padre quiere darle cuenta y no tiene correo para
él, la salida es el alias (`papa+juan@dominio.com`).

**Cierra:** INS-2, y la cañería de FIC-2.

---

## 2 · «Justificado» es una marca, sin motivo

**Decisión.** El entrenador toca «Justificado» y el sistema no le pregunta nada.
Sin campo de texto, sin adjunto, sin aprobación.

**Por qué.** Se pasa lista con los chicos corriendo alrededor. Cada campo de
texto ahí es una lista que no se toma. El entrenador sabe por qué lo puso.

**Qué implica.** No hay nada que construir. El hallazgo se cierra como decisión
de producto.

**Cabo suelto que sí se ata:** el seed escribe 82 justificativos que la
aplicación nunca escribe ni muestra. Eso ya confundió a un auditor, que reportó
como defecto que las columnas estuvieran vacías cuando estaban llenas de datos
falsos. Se le saca esa escritura al seed y las columnas quedan honestamente
vacías.

**Cierra:** ASI-2.

---

## 3 · Retraso creciente en el login, no bloqueo de cuenta

**Decisión.** Al tercer intento fallido la cuenta espera 1 segundo antes de
responder; al cuarto 2; al quinto 4, duplicando, con techo de un minuto.

**Por qué no bloqueo duro.** Trabar la cuenta tras N intentos regala un ataque
nuevo: cualquiera puede dejar a un socio afuera del sistema sin saber ninguna
contraseña. El retraso creciente mata la fuerza bruta igual —probar mil
contraseñas pasa de segundos a días— y el socio que se equivoca dos veces y
acierta a la tercera casi no lo nota.

**Estado actual:** solo existe un tope genérico de 60/minuto por IP
(`auth_router.py:21`), que no protege a una cuenta puntual.

**Cierra:** TRA-4 (issue #111).

---

## 4 · La cuota vencida no impide entrenar

**Decisión.** Se puede asignar a un horario a un alumno con la cuota vencida.
El administrador ve un **aviso no bloqueante** al hacerlo.

**Por qué.** El chico entrena y la cuota se regulariza aparte. Bloquear la
inscripción por un trámite administrativo deja a un pibe afuera de la cancha, y
eso no es lo que hace un club.

**Cierra:** INS-6.

---

## 5 · Una sola fila por categoría y día

**Decisión.** Es un invariante, con candado en la base.

**Por qué se decidió sin consultar.** Las horas de un horario se **derivan de la
categoría** (`asistencia_servicio.py:47-48`), así que dos filas de
Formativo–Lunes son idénticas: mismo día, misma hora. No existe el caso legítimo
de «dos grupos distintos el lunes». Si el club llegara a necesitar dos turnos el
mismo día para una categoría, esta decisión se replantea.

**Qué rompe hoy no tenerlo:** un alumno asignado después del duplicado queda
enrolado en **ambas** filas del mismo día, lo que contradice la inscripción
atómica del issue #181.

**Cierra:** INS-3.

---

## 6 · Pagos parciales y membresía anual, fuera de alcance

**Decisión: ninguno de los dos entra en este lanzamiento.** Se venden y se
cobran meses completos, como hasta hoy.

**La regla del múltiplo exacto SE QUEDA** (`monto % precio != 0`,
`membresia_pago_servicio.py:308`). Es la que garantiza que todo pago represente
meses completos, y de ella depende que el cálculo de cobertura sea simple.

**Lo único que sí entra de este bloque: el botón deshabilitado deja de ser
mudo.** El mensaje de `findProblem()` ya existe y hoy nunca se muestra porque el
botón está apagado. Se muestra mientras la persona escribe.

**Corrección de registro:** una versión anterior de este documento daba los
pagos parciales por aprobados. Fue un error de interpretación al redactarlo — el
dueño los había sacado de alcance junto con la anual, en la misma frase. Queda
asentado para que nadie los reponga leyendo la versión vieja.

**La membresía anual sale de alcance, y no deja hueco.** Se vende como
**descuento del catálogo sobre doce meses adelantados**, y eso funciona hoy sin
tocar código, por el orden de operaciones: la regla del múltiplo se evalúa sobre
el monto **base** (línea 308) y el descuento se congela **después** (línea 319).
El padre escribe $300 —doce meses de $25, múltiplo válido—, se aplica el
descuento anual, y el pago queda en $270.

**Nota:** `TipoModalidad.PERSONALIZADA` existe en el enum y no se usa en ninguna
parte del código. Un plan con duración propia exigiría columna nueva, migración
y lógica de cobertura distinta: eso es lo que se difiere.

**Verificado al implementar:** la cobertura se calcula sobre el monto **base**,
antes del descuento (`membresia_pago_servicio.py:308` evalúa `datos.monto`;
`_congelar_descuento` corre después, en :319). El orden es el correcto y hay que
preservarlo: la anual de $300 con descuento a $270 tiene que dar doce meses, no
once.

### Ampliación del 11 de agosto — el backend calcula el período

Al implementar los parciales apareció un agujero que la auditoría no había
encontrado, y que cambia el alcance de esta decisión.

**`POST /membresias/pagos` acepta `fecha_inicio` y `fecha_fin` del cliente y
solo valida que una sea anterior a la otra.** Nada ata el monto al período.
Reproducido en vivo con el token de un representante real, sobre una membresía
de $25 mensuales:

```
{"membresia_id":25,"persona_id":36,"monto":25,
 "fecha_inicio":"2026-08-11","fecha_fin":"2027-08-11"}  → 201
```

Un mes de cuota, doce meses de cobertura. Lo atenúa que el pago queda pendiente
y lo aprueba un administrador; no lo atenúa que ese administrador valida «¿pagó
los $25?» y no «¿el período es correcto?» — la interfaz le calcula las fechas,
así que no tiene motivo para sospechar.

Por qué nadie lo vio: la regla del múltiplo valida el **monto**, y eso da la
ilusión de que el período está atado. Son dos cosas independientes.

**Decisión ampliada: el backend calcula `fecha_inicio` y `fecha_fin` a partir
del monto y la cuota, y deja de aceptarlos del cliente.** La cobertura arranca
donde termina la del último pago aprobado, y se extiende tantos meses completos
como el monto haya comprado.

Se descartó la alternativa de agregar una bandera `otorga_cobertura` a `Pago`:
resolvía los parciales pero dejaba el agujero abierto, y sumaba un campo que
también venía del cliente.

**Consecuencias que hay que sostener:** `validar_pago` deja de activar la
membresía incondicionalmente (activa solo si el pago compró cobertura); los tres
sitios que derivan vigencia de `Pago.fecha_inicio/fecha_fin`
—`membresia_repositorio.listar_membresias_activas_por_representante`,
`vencimientos_tareas.py`, `alertas_tareas.py`— quedan coherentes con el cálculo
nuevo; y los pagos históricos **no se recalculan**, sus fechas son historia
congelada.

**Aclaración que corrige una premisa:** los descuentos **ya funcionan** con la
regla del múltiplo, porque ésta compara contra `monto_aplicado` —el precio ya
con descuento—, no contra el precio de lista.

**Cierra:** PAG-5. Habilita los parciales.

---

## 7 · Un pago sin comprobante sobrevive en el historial

**Decisión.** Si el comprobante falla al subir después de que el pago se creó,
**el pago no se revierte**: queda en el historial marcado «falta el
comprobante», con un botón para subirlo desde esa misma fila.

**Por qué.** El padre ya declaró que pagó. Borrar esa declaración porque falló
una subida de archivo es perder información real. Y revertir tiene su propio
riesgo: si la reversión falla, quedás igual que ahora.

**Qué rompe hoy:** el formulario queda abierto invitando a reintentar, y el
reintento choca contra el pago fantasma que él mismo creó («ya tenés un pago
pendiente»). El padre queda trabado sin salida.

**Cierra:** PAG-1, el único bloqueante de la auditoría.

---

## 8 · Qué va en el panel del entrenador

**Decisión.** De arriba a abajo:

1. **La próxima sesión**, grande, con entrada directa a pasar lista.
2. **Los cuatro conteos de la última lista** —presente, tardanza, justificado,
   ausente— en `StatGrid`, como el panel de admin. Hoy son `Badge` sueltos en un
   flex.
3. **Las últimas listas del club**, sin autor.
4. **El gráfico de torta** con la distribución de asistencias, al lado del aviso
   de faltas crónicas que ya existe (y al que hay que arreglarle el nombre: hoy
   dice «Persona 15»).

**Dos ideas descartadas, y por qué** — las dos murieron contra el mismo hecho
del modelo:

- *«Las listas que el entrenador debe tomar»*: no existe relación
  entrenador–horario. El club no asigna titulares, «la clase la da el entrenador
  disponible» (`modelos.py:506-507`, issue #13). No hay a quién deberle una
  lista.
- *«Las últimas listas que él tomó»*: `Asistencia` **no guarda quién tomó la
  lista**, y es deliberado — el modelo dice «No registra quién dictó la sesión»
  (`modelos.py:536`).

Por eso la tarjeta muestra **las últimas listas del club**: cero cambios de
base, y encaja con que cualquier entrenador pueda tomar cualquier lista.

**Distinción que queda registrada para más adelante:** *quién dictó la clase* y
*quién tipeó la lista* no son lo mismo. Lo que el modelo decidió no guardar es
lo primero, por cómo se le paga al entrenador. Lo segundo es auditoría —quién
marcó ausente a un chico— y hoy no existe. Agregar `registrado_por` a
`Asistencia` queda como mejora posterior al lanzamiento, y se justifica por la
trazabilidad, no por el panel.

**Se deja afuera a propósito:** la agenda de la semana completa. Ocuparía media
pantalla para decirle al entrenador algo que ya tiene memorizado — los horarios
son fijos.

**Cierra:** DSH-2.

---

## Lo que no requiere decisión

Los otros dieciséis hallazgos confirmados tienen causa localizada y una sola
solución razonable. Se implementan sin consultar: el logout que no revoca, la
cuenta del menor que no se crea, la alergia que no se borra, el título tapado en
móvil, el «sesións», los mensajes de error que no llegan, las pantallas sin
paginar, y el resto.
