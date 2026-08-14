# Fix 23 · La categoría de un horario ya la manda la tabla, no el enum

- **Cierra:** M1 — la categoría de un horario se lee de la tabla
  `categoria_horario`, no del enum `Categoria`.
- **Decisión que lo gobierna:** el propio docstring de `CategoriaHorario`
  ("movido a tabla para que el club pueda sumar una categoría nueva sin un
  deploy de código", `backend/app/dominio/modelos.py:478-479`).
- **Rama:** `feat/categoria-tabla-manda`
- **Commits:**
  - `9e0a365` — fix(attendance): drop the closed enum gate on categoria
  - `f4247ee` — fix(groups): open the categoria type past the fixed five

## El problema

Las migraciones ya habían movido la categoría de un horario a una tabla
real (`categoria_horario`), pero el código todavía la trataba como si
fueran solo 5 valores fijos. Si un admin sumaba una categoría nueva
directamente en esa tabla, el filtro de horarios la rechazaba con un
error 422, crear un horario para ella reventaba, y ni siquiera aparecía
como opción al crear un horario nuevo desde la pantalla de Horarios.

> *La captura del «antes» que este dossier citaba
> (`img/23-categoria-tabla-manda-antes.png`) nunca llegó a versionarse. La
> referencia se deja anotada en vez de rota: el resto de `fixes/` conserva sus
> 95 imágenes, así que el faltante es de este dossier, no de la carpeta.*

## Qué se hizo

**Backend:** el enum `Categoria` dejó de tipar cualquier campo que reciba
un código de categoría (el filtro `GET /horarios`, los DTOs de
crear/actualizar horario, `listar_horarios`) — ahora son `str` lisos, y la
única validación real es que exista la fila en `categoria_horario`
(`AsistenciaServicio._validar_dia_y_derivar_horas`, que ya hacía esa
consulta). El enum se mantiene como constante con nombre para las 5
categorías originales (lo usan ~13 archivos de test), pero ya no gatea
nada. `etiquetas.py` perdió `categoria_en_castellano`/`_CATEGORIAS`: ese
módulo es para enums CERRADOS, y una categoría vive en una tabla abierta;
el label ahora sale de `CategoriaHorario.label`, leído donde el servicio
ya tenía la fila a mano.

Se descartó borrar el enum `Categoria` directamente — hubiera forzado una
reescritura mecánica de una docena de archivos de test por cero beneficio
de comportamiento, ya que sigue funcionando como constante tipada (es un
`str` subclase).

**Frontend:** `Categoria` pasó de una unión cerrada de 5 literales a
`string`. Se borró `isCategoria` (filtraba en silencio cualquier código
fuera de esos 5) y `CATEGORIA_OPTIONS` (el `<select>` de "Nuevo Horario"
ahora itera el catálogo `categorias` recién cargado, no una lista
estática). `DEFAULT_CATEGORIA` dejó de ser una constante de módulo — se
calcula en `openCreateForm` a partir del catálogo ya cargado.

## El candado

`test_categoria_seedeada_fuera_del_enum_funciona_de_punta_a_punta` en
`backend/tests/test_horario_categoria.py`: siembra una sexta categoría
(`BEGINNERS`/"Principiantes") directamente en `categoria_horario` — fuera
del enum a propósito — y prueba que `GET /horarios?categoria=BEGINNERS`
no da 422 y que el mensaje de "horario duplicado" lleva su label real.

```
# Antes del fix (rojo, razón correcta: 422 por el Query tipado Categoria)
FAILED tests/test_horario_categoria.py::test_categoria_seedeada_fuera_del_enum_funciona_de_punta_a_punta
    resp = client.get("/api/v1/asistencias/horarios", params={"categoria": "BEGINNERS"})
>   assert resp.status_code == 200
E   assert 422 == 200
E    +  where 422 = <Response [422 Unprocessable Entity]>.status_code
1 failed, 1 warning in 0.72s

# Después del fix (verde)
tests/test_horario_categoria.py::test_categoria_seedeada_fuera_del_enum_funciona_de_punta_a_punta PASSED
10 passed, 1 warning in 0.72s
```

## La prueba

> *Misma situación que arriba: la captura del «después»
> (`img/23-categoria-tabla-manda-despues.png`) no se versionó. La verificación
> manual que se describe a continuación sí quedó escrita, y es la prueba que
> este dossier conserva.*

Verificación manual sobre stack propio (Postgres + backend en puertos
libres, sin tocar el QA compartido): sembré `BEGINNERS`/"Principiantes"
directo en Postgres, `GET /horarios?categoria=BEGINNERS` devolvió `200`,
crear un horario duplicado devolvió `"La categoría Principiantes ya tiene
un horario el día lunes."` (antes: `KeyError`), y en `/groups` con el
frontend corriendo contra ese backend "Principiantes" apareció como
opción del `<select>` de categoría y como card propia en la grilla de
Horarios, junto a las 5 originales.

## Lo que NO cambió

- El candado de una sola fila por (categoria, dia_semana) — `uq_horario_categoria_dia`
  y el chequeo en `crear_horario` — sigue igual; solo cambió de dónde sale
  el label de su mensaje de error.
- `rango_edad` sigue siendo copy de orientación, no una regla.
- La inscripción atómica por categoría (`asignar_alumno_a_horario`/
  `desasignar_alumno_de_horario`) no se tocó.
- No hay pantalla de alta/edición de categorías — sigue siendo la fila que
  ya exista en la tabla (sembrada a mano o por migración), como ya decía el
  docstring de `CategoriaHorario`.
- No hubo migración: es un cambio de capa de aplicación, el esquema no
  cambió.
