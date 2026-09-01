# Contrato de rutas entre el BFF y el backend

> **Estado:** Activa · **Responsable:** desarrollo backend/frontend (asignación
> nominal pendiente) · **Audiencia:** desarrollo y QA
> **Creado:** issue [#900](https://github.com/AlejandroTatum/cata_club/issues/900) ·
> **Continúa:** [`glossary-contract.md`](glossary-contract.md) (issue
> [#903](https://github.com/AlejandroTatum/cata_club/issues/903))

## Qué compara este gate

El frontend no habla con FastAPI desde el navegador: cada pantalla llama a una
ruta propia de Next bajo `frontend/src/app/api/`, y ese handler reenvía al
backend. Ese reenvío es el punto de rotura silenciosa: si un router cambia una
ruta, nada en el repositorio se pone rojo hasta que alguien abre la pantalla.

`tests/test_bff_contract.py` cierra ese hueco comparando **rutas**:

- **Lo que el BFF consume.** Ningún handler escribe `/api/v1`. Ese tramo vive en
  la variable de entorno `BACKEND_API_URL` (`frontend/src/lib/server/auth.ts`,
  cuyo ejemplo documentado es `http://localhost:8000/api/v1`). Cada llamada pasa
  una ruta **relativa** a ese prefijo, por ejemplo
  `backendFetch("/asistencias/horarios-publicos", …)`.
- **Lo que el backend declara.** La misma cadena se arma con el
  `APIRouter(prefix=…)` del router más la ruta del decorador:
  `APIRouter(prefix="/asistencias")` + `@router.get("/horarios-publicos")`.

Las dos mitades tienen que coincidir exactamente. Esa igualdad es la
comparación; el prefijo de montaje queda fuera porque las dos son relativas a
él.

## Las tres superficies que se leen

Cubrir sólo `route.ts` dejaría afuera, entre otras cosas, toda la superficie de
autenticación. El gate lee:

| # | Superficie | Qué contiene |
| --- | --- | --- |
| 1 | `frontend/src/app/api/**/route.ts` | Los handlers, que llaman a los ayudantes compartidos |
| 2 | Las mismas llamadas armando la URL a mano | `fetch(\`${getBackendApiUrl()}/chatbot/consultar\`, …)` y sus dos hermanas de `ranking/notificaciones` |
| 3 | `frontend/src/lib/server/*.ts` | `auth.ts` (`/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`) y los adaptadores, como `payments-adapter.ts` |

Los ayudantes a los que se ancla la búsqueda son `backendFetch`,
`backendFetchAuthed`, `proxyToBackend`, `proxyBackendGet`, `proxyBackendPdfGet`,
`publicCatalogGet`, `backendUrl`, `fetchAllPages`, `proxyMembresiaAction` y
`anonymousAuthPost`. Dos más —`postCatalogResource` y `patchCatalogResource`—
no reciben la ruta como argumento posicional sino dentro de un objeto de
opciones; para esos el ancla es la propiedad (`backendPath:`, `buildPath:`).

El anclaje no es decorativo: una búsqueda de «toda cadena que empieza con `/`»
también levanta la prosa de los comentarios (`/trainer/attendance`,
`/personas/{id}`) y el gate se llenaría de rutas que nadie consume.

Esa lista de ayudantes se verifica sola. Todo lo exportado desde `lib/server`
que reciba un parámetro `path`/`backendPath` de tipo `string` tiene que estar
anclado; si alguien agrega un ayudante nuevo y no lo declara, el gate lo
denuncia en vez de dejar sus llamadas fuera en silencio.

## Cómo se normaliza una ruta

Las rutas consumidas aparecen en tres formas, y ninguna se arma con una variable
de runtime:

1. Literal simple: `"/membresias/tipos"`.
2. Plantilla cuyo único `${…}` ocupa un segmento entero:
   `` `/personas/${personaId}/foto` `` → `/personas/{param}/foto`.
3. Plantilla con un sufijo de query: `` `/membresias/mias${query}` `` →
   `/membresias/mias`. Se recorta también desde el primer `?` literal.

Del lado del backend, los parámetros están nombrados (`{codigo}`,
`{horario_id}`) y el frontend interpola valores. Por eso los dos lados colapsan
al mismo marcador: se comparan **posiciones de parámetro, no nombres**.

## Qué pone el gate en rojo

- Una ruta consumida que ningún router declara. El fallo nombra la ruta y el
  archivo que la consume, ordenado.
- Un handler de `app/api` que arme su ruta con una variable: el gate no puede
  verla, así que la denuncia en lugar de ignorarla. Sólo la capa de ayudantes
  (`backend-client.ts`, `bff-helpers.ts`, `paged-fetch.ts`,
  `proxy-membresia-action.ts`) puede reenviar una ruta recibida por parámetro,
  porque ese es su trabajo.
- Cualquiera de los dos inventarios vacío, o un parser que extraiga por debajo
  de su piso. Sin eso, una expresión regular rota dejaría el gate verde sin
  haber comparado nada.
- Un montaje no uniforme en `backend/main.py`: si algún router dejara de
  montarse bajo `/api/v1`, la premisa de la comparación se cae.

## Qué el gate deja libre

Los routers declaran 113 decoradores sobre 90 rutas distintas (varios métodos
comparten ruta). El BFF consume 78 de esas 90 desde 108 sitios de llamada. Las
12 restantes —toda la superficie de `geografia`, `/auth/registro`,
`/membresias/estadisticas`, entre otras— no tienen ningún handler que las use.

**Cambiar, renombrar o borrar una ruta no consumida no pone el gate en rojo**, y
hay dos tests que lo demuestran. El contrato protege lo que está en uso; no
congela la API.

## Alcance y continuación

Este gate verifica **rutas**. Los enums compartidos y los campos obligatorios de
los DTO son el PR hermano del mismo issue y no se comprueban acá.

Es continuación explícita del gate del glosario:
[`glossary-contract.md`](glossary-contract.md) declara en la fila 5 de sus
divergencias inventariadas que las superficies de badges (`status-badges.ts`,
`membership-status.ts`) «no están cubiertas por este gate» y quedan para un
issue hijo del frontend. Este contrato extiende esa cobertura por el lado de las
rutas en vez de duplicarla.

## Cómo se corre

```bash
cd backend && uv run pytest ../tests/test_bff_contract.py -v
```

Offline: sin Postgres, sin Docker, sin servidor de desarrollo y sin red. Lee los
routers y los handlers como texto, igual que `tests/test_glossary_contract.py`
lee el glosario. Si alguna vez necesitara importar la aplicación FastAPI, el
diseño estaría mal: la suite de raíz corre en CI sin bloque `env:`.
