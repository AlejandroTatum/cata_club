# Fix 18 · El buscador de alumnos no encontraba nombre y apellido juntos

- **Cierra:** buscador de alumnos devuelve cero resultados al escribir nombre y apellido juntos
- **Decisión que lo gobierna:** ninguna decisión de negocio nueva — es un defecto de la consulta, no una decisión de producto
- **Rama:** `fix/buscar-nombre-completo`
- **Commits:** (pendiente de commitear)

## El problema

`GET /personas/buscar` comparaba la búsqueda completa contra `nombres` o contra
`apellidos`, cada una por separado, nunca contra las dos juntas. Buscar
"Emilio" o "Zambrano" solos encontraba a la persona; buscar "Emilio Zambrano"
no encontraba nada — y sin ningún error: el desplegable simplemente se
quedaba vacío, como si el alumno no existiera. Lo sufre `StudentSearch`, el
mismo componente que usan `/reports` (el filtro por alumno del reporte de
asistencia) y `/trainer/attendance/history`.

![antes](img/18-buscar-nombre-completo-antes.png)

## Qué se hizo

En `PersonaRepositorio.buscar_por_nombre` (`backend/app/infraestructura/repositorios/persona_repositorio.py`),
la búsqueda parte la consulta en palabras y exige que **cada palabra**
matchee `nombres` **o** `apellidos` (un AND de ORes), en vez de comparar la
cadena entera contra una sola columna:

```python
palabras = q.split()
if palabras:
    stmt = stmt.where(
        and_(*[
            or_(Persona.nombres.ilike(f"%{palabra}%"), Persona.apellidos.ilike(f"%{palabra}%"))
            for palabra in palabras
        ])
    )
```

Esto resuelve los casos reales del club sin inventar nada:

- **Orden invertido** ("Zambrano Emilio"): el AND es conmutativo, no importa
  en qué orden aparezcan las palabras.
- **Apellido compuesto** ("Ariana Chavez" encuentra a "Ariana Chavez Bravo"):
  cada palabra hace `ILIKE` parcial, así que una porción del apellido
  compuesto alcanza.
- **Espacios de más**: `str.split()` sin argumentos colapsa cualquier corrida
  de espacios en blanco.
- **Una sola palabra**: con una palabra el AND tiene un solo término — mismo
  comportamiento que antes.

**Acentos** ("Cedeño" tecleado "Cedeno"): la base NO normaliza acentos hoy
(no hay `unaccent` ni columna generada), así que ese caso sigue sin
encontrarse. No lo inventé porque no es parte de este hallazgo — lo dejo
explícito para que no se lea como un descuido.

**Plan de la consulta**: antes y después el filtro usa `ILIKE '%...%'` con
comodín inicial, que ya impedía usar cualquier índice de `nombres`/
`apellidos` (no existe ninguno — solo hay índices en las FK). Confirmé con
`EXPLAIN` contra el Postgres real que las dos versiones son `Seq Scan`; el
fix agrega una cláusula más al filtro (costo `3.29` → `3.72` sobre 93 filas),
no cambia el tipo de plan. Con los ~86-93 alumnos del club esto no se nota;
si el padrón creciera a cientos, valdría agregar un índice `pg_trgm` — pero
eso es una mejora aparte, no parte de este fix.

**Otros buscadores con el mismo defecto**: ninguno. `nombres.ilike`/
`apellidos.ilike` aparece en un solo lugar de todo `backend/app`:
`PersonaRepositorio.buscar_por_nombre`. Es el único endpoint de búsqueda de
personas (`GET /personas/buscar`) — no hay un buscador separado para
Miembros ni para el roster administrativo (`GET /personas/` no filtra por
texto, solo pagina).

## El candado

`test_buscar_nombre_completo_encuentra_a_la_persona` en
`backend/tests/test_personas.py` — el caso real reportado: "Emilio Zambrano"
debía dar cero resultados sin el fix. Junto con él quedaron 6 tests más
cubriendo orden invertido, apellido compuesto parcial, espacios de más, sólo
nombre, sólo apellido, y sin resultados.

```
$ TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_personas.py -k buscar -q

# ANTES del fix
FAILED tests/test_personas.py::test_buscar_nombre_completo_encuentra_a_la_persona
FAILED tests/test_personas.py::test_buscar_nombre_completo_en_orden_invertido_encuentra
FAILED tests/test_personas.py::test_buscar_con_apellido_compuesto_parcial_encuentra
FAILED tests/test_personas.py::test_buscar_con_espacios_de_mas_encuentra
4 failed, 5 passed, 26 deselected, 1 warning in 0.84s

# DESPUÉS del fix
.........                                                                [100%]
9 passed, 26 deselected, 1 warning in 0.74s
```

Suite completa del área (`test_personas.py`, `test_paginacion_listados.py`,
`test_baja_logica_persona.py`, `test_guardia_autorizacion_rutas.py`): 68
passed. Suite completa del backend: 944 passed, 2 skipped — sin regresiones.

## La prueba

Verificado contra el Postgres real de QA (no la base de test), levantando un
backend propio en `:8001` apuntado a ese mismo Postgres y un frontend propio
en `:3001` — sin tocar el stack compartido de `:3000`/`:8000`. La captura
"antes" es el stack de QA sin el fix; la "después" es mi propio stack con el
fix, misma persona real de la base (`Emilio Zambrano Ponce`, id 14).

![después](img/18-buscar-nombre-completo-despues.png)

Antes, el campo tiene "Emilio Zambrano" escrito y el desplegable no aparece
—ningún resultado, ningún error—. Después, el mismo texto abre el
desplegable con "Emilio Zambrano Ponce".

También comprobé por API directa contra ese mismo Postgres (vía `curl` con
token de admin) los siete casos del candado, incluida `q=Ariana Chavez` →
`Ariana Chavez Bravo` y `q=Zambrano Emilio` → mismo resultado que en orden
directo. `/trainer/attendance/history` usa el mismo `StudentSearch` y el
mismo endpoint, así que el fix lo cubre sin cambios propios.

## Lo que NO cambió

- El endpoint `GET /personas/buscar` sigue devolviendo una lista simple
  (`List[PersonaBusquedaDTO]`), no el envelope `PaginatedResponse` — es un
  autocomplete, no un listado paginado del padrón, y esa forma de respuesta
  no formaba parte del hallazgo.
- `skip`/`limit` y el resto de la cadena (router → servicio → repositorio)
  quedaron intactos.
- No se agregó normalización de acentos ni de mayúsculas más allá de lo que
  ya hacía `ILIKE` (case-insensitive de por sí).
- No se tocó ningún otro buscador: no existe otro con este defecto.
