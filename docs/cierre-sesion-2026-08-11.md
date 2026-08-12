# Cierre de sesión — 10 y 11 de agosto de 2026

Lo que se hizo, lo que se decidió, y sobre todo **lo que queda abierto**. Si
volvés a esto dentro de un mes, empezá por la última sección.

---

## En una frase

Se auditó el sistema entero dos veces, se cerraron 41 defectos con su test, se
tomaron ocho decisiones de negocio que faltaban, y se construyó la
administración de categorías. **Nada está publicado**: todo vive en `main`
local.

---

## Cómo se llegó acá

**Arrancó con una pregunta simple** —«¿qué falta para lanzar?»— y la primera
respuesta fue inútil, porque el índice de pendientes mentía: declaraba una base
que ya no existía, citaba un archivo borrado dos meses antes, y traía conteos
viejos.

Eso marcó el método de toda la sesión: **nada se afirma sin re-derivarlo contra
el código de hoy.**

### Primera auditoría

Seis agentes recorrieron la aplicación por flujo, con navegador real y contra
Postgres. Dieron **53 hallazgos**. Dos verificadores adversariales los
sometieron a refutación y quedaron **24**: el resto era opinión, dato viejo del
seed, o cosas que no reproducían.

Esa proporción es el dato: **más de la mitad de lo que reporta una auditoría sin
verificar es ruido.**

Y en el medio apareció por qué el dueño creía que su equipo no había hecho el
trabajo: **el entorno de QA corría un frontend de tres días antes**, sin
ninguno de los diecinueve commits que sí implementaban lo que él pedía. No era
el código: era el contenedor.

### Los arreglos, y una segunda auditoría

17 ramas cerraron los 24 hallazgos. Después se integró todo y **se volvió a
auditar de punta a punta**.

Resultado: **17 hallazgos nuevos y cero regresiones.** Integrar 17 ramas no
rompió nada de lo ya cerrado. Pero aparecieron dos bloqueantes que antes no
podían verse, y un patrón:

> Casi todo lo nuevo eran **funciones que estrenaban con un defecto**. No por
> mal trabajo — cada pieza era correcta en su rama. Fallaban en el borde donde
> se juntaban con lo que ya estaba.

8 ramas más los cerraron. Después, tres cosas que el dueño encontró recorriendo
la app en dos minutos, y que ninguna auditoría automática había visto.

---

## Los tres bloqueantes, y de dónde salió cada uno

Ninguno vino de leer código. Eso es lo que hay que recordar.

**Un pago quedaba huérfano** cuando fallaba la subida del comprobante: el pago
ya estaba creado, el padre no lo veía, y reintentar chocaba contra su propio
pago fantasma. Salió de **recorrer la aplicación**.

**Un socio podía pagar un mes y pedir doce.** El backend aceptaba las fechas de
cobertura que le mandara el cliente. Salió de que un agente **frenó antes de
escribir código** en vez de entregar lo pedido.

**Los comprobantes bancarios eran públicos y enumerables.** El backend frenaba
el acceso por API, pero la URL del archivo no pasaba por el backend: quien
viera uno legítimo podía contar hacia adelante y bajarse el de cualquier
familia. Salió de **auditar seguridad sobre una superficie que nadie había
mirado**.

---

## Las ocho decisiones de negocio

Están completas en
[`decisiones-de-negocio-2026-08-11.md`](./decisiones-de-negocio-2026-08-11.md),
con su porqué. En resumen:

| | Decisión |
|---|---|
| **Representante** | Uno solo por chico, y lo vincula él mismo sin aprobación de nadie |
| **Justificado** | Es una marca sin motivo — se pasa lista con los chicos corriendo alrededor |
| **Login** | Retraso creciente, nunca bloqueo de cuenta |
| **Cuota vencida** | No impide entrenar: avisa y deja seguir |
| **Horarios** | Una fila por categoría y día, con candado en la base |
| **Pagos** | Parciales y membresía anual, fuera de alcance |
| **Comprobante fallido** | El pago sobrevive esperando el comprobante |
| **Panel del entrenador** | Próxima sesión, conteos en tarjetas, últimas listas del club |

**Una queda registrada con su riesgo asumido:** la vinculación sin aprobación.
Se planteó que la cédula de un menor no es un secreto y que quien la conozca
puede quedarse con ese chico; se ofreció que aprobara el representante actual.
El dueño evaluó contra su comunidad y decidió la vía directa. Queda con fecha y
dueño por si algún día hay que revisarla.

---

## Lo que se construyó, además de arreglar

- **La ficha médica llegó a las familias.** El representante corrige la de cada
  hijo; un socio mayor de edad, la suya. Un menor con cuenta propia, no.
- **Vinculación de representante**, con cuatro guardarraíles verificados.
- **«Mi cuenta» rediseñada** sobre una maqueta que el dueño eligió entre tres.
- **El panel del entrenador**, rehecho.
- **Administración de categorías**: el admin crea una categoría con su nombre,
  su franja y sus días, en una sola operación. Antes el botón «Nuevo Horario»
  no podía crear nada.

---

## Lo que queda abierto

### 1 · Nada está publicado

Todo vive en `main` local, con `respaldo/pre-integracion`, `-2` y `-3` para
volver. **Ningún push, ningún PR, ningún issue.**

Publicar según las reglas del repo son ~28 ramas con su issue y su PR. Es la
primera decisión de la próxima sesión.

### 2 · Los tres bloqueantes de despliegue

No son producto — son el deploy, y siguen intactos desde el principio:

- `docker-compose.prod.yml` sin TLS, sin límites de memoria, sin rotación de logs
- `.env.example` incompletos
- Sin métricas ni trazas

Para una demo no hacen falta. Para que el club lo use, sí. **Son un solo PR de
infraestructura.**

### 3 · Residuos conocidos

- **El 422 de Pydantic** llega como arreglo en inglés y nunca alcanza al
  usuario. Es estructural: 31 rutas comparten una puerta que exige texto.
- **Los comprobantes ya subidos** conservan su URL pública. El arreglo protege
  lo nuevo; los viejos necesitan una migración de datos cuando haya credenciales
  reales.
- **`registrado_por` en `Asistencia`**: hoy no se guarda quién tomó la lista.
  Queda como mejora de trazabilidad.
- **El correo no se puede probar en QA** — falta el worker a propósito, y ahora
  `make qa-up` lo avisa en su salida.

### 4 · Lo que el dueño todavía no revisó

Recorrió unos minutos y encontró **dos defectos reales** que ninguna auditoría
había visto. Eso dice que el recorrido humano sigue siendo el mejor detector que
tenemos, y que quedó a medias.

---

## Dónde está cada cosa

| | |
|---|---|
| `docs/auditoria-qa/README.md` | La primera auditoría, un hallazgo por sección con su captura |
| `docs/decisiones-de-negocio-2026-08-11.md` | Las ocho decisiones con su porqué |
| `docs/fixes/` | Un documento por arreglo: problema, antes, qué se hizo, el test, después |
| `docs/fixes/00-INTEGRACION*.md` | Las tres integraciones, con sus conflictos y cómo se resolvieron |
| `docs/pendientes.md` | El índice viejo — **histórico, ya no se mantiene** |

---

## Lo que aprendimos, y conviene no volver a aprender

**El entorno miente si no lo verificás.** `make qa-reset` no reconstruye
imágenes: solo `qa-up` trae `--build`. Un entorno «reseteado» puede seguir
corriendo código de días atrás. Verificar la fecha de la imagen contra el último
commit es ahora el paso cero de cualquier auditoría.

**Verificar rinde más que explorar.** Los dos hallazgos más graves salieron de
refutar lo que otro afirmó, no de buscar cosas nuevas.

**Un pedido del dueño es su propia justificación.** La primera rúbrica de
verificación descartaba como «opinión» todo lo que no violara una regla escrita,
y así filtró tres pedidos suyos. Corregido: el filtro de opinión aplica solo a
lo que propone un auditor por su cuenta.

**Frenar a tiempo vale más que entregar.** El agujero de cobertura apareció
porque un agente paró antes de escribir código y preguntó.

**Los defectos viven en las costuras.** Los peores de esta sesión estaban entre
dos capas donde cada una pasaba su propio test: el BFF que descartaba campos, el
frontend que se tragaba su propio mensaje, la pantalla que llamaba al editor sin
el nombre.

**Un fallo silencioso es peor que un error visible**, porque convierte un
problema en un dato plausible. Apareció cuatro veces: el 403 que degradaba
nombres a «Persona 15», el campo que decía «guardado» sin guardar, el tope que
truncaba sin avisar, y el `NaN` que hacía que toda comparación de edad diera
falso.
