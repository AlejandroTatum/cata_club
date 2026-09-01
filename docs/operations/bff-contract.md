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

## Los enums compartidos

Las rutas coinciden; lo que viaja por ellas es otro contrato. Los **14** enums de
`backend/app/dominio/enums.py` no tienen todos la misma relación con el frontend,
y un gate que asumiera una sola se equivocaría en la mayoría. Se declaran cuatro:

| Relación | Qué significa | Qué se compara |
| --- | --- | --- |
| (a) Identidad | Una unión de TypeScript nombra los mismos valores en mayúsculas | El conjunto de valores, en las dos direcciones |
| (b) Traducción | Un `Record<>` los lleva 1:1 a códigos de la aplicación | El conjunto de **claves** y el de **valores** del mapa, más que el inverso sea el inverso |
| (c) Muchos a uno | El pliegue es una decisión documentada, no una deriva | Sólo las claves; exigir valores distintos denunciaría la decisión |
| (d) Excluido / sin contraparte | La fuente de verdad no es el enum, o nada cruza el límite | Nada, pero el motivo se escribe y se verifica |

Todo enum cae en **exactamente una**. Un enum nuevo sin clasificar pone el gate
en rojo: esa es la parte que no envejece.

| # | Enum del backend | Relación | Declaración de TypeScript | Estado |
| --- | --- | --- | --- | --- |
| 1 | `TipoRol` | (a) + (b) | `BackendTipoRol` (`types/domain.ts:216`) + `USER_ROLE_BY_BACKEND_ROLE` (`lib/auth-utils.ts:421`) + `BACKEND_ROLE_TO_USER_ROLE` (`lib/server/auth.ts:661`) | verificado |
| 2 | `TipoSangre` | (a) | `TipoSangre` (`types/domain.ts:204`) | verificado |
| 3 | `TipoNotificacion` | (a) | `TipoNotificacion` (`types/domain.ts:381`) | verificado (además por `tipo-notificacion-parity.test.ts`) |
| 4 | `EstadoPago` | (a) | `BackendEstadoPago` (`lib/server/payments-adapter.ts:22`) y `EstadoPago` (`lib/status-badges.ts:25`) | verificado (las dos declaraciones) |
| 5 | `TipoPago` | (a) | `BackendTipoPago` (`lib/server/payments-adapter.ts:23`) | verificado, con **1 divergencia inventariada** |
| 6 | `EstadoMembresia` | (a) + (c) | `BackendEstadoMembresia` (`lib/membership-status.ts:9`) + `MEMBERSHIP_STATUS_BY_ESTADO` (`:14`) | verificado, con **1 divergencia inventariada** |
| 7 | `DiaSemana` | (a) + (b) | `BackendDiaSemana` (`lib/server/attendance-adapter.ts:25`) → `DiaSemana` (`types/domain.ts:191`) | verificado |
| 8 | `EstadoAsistencia` | (a) + (b) | `BackendEstadoAsistencia` (`attendance-adapter.ts:26`) → `EstadoAsistencia` (`types/domain.ts:319`) | verificado |
| 9 | `Categoria` | (d) excluido | `export type Categoria = string` (`services/categorias.ts:32`) | **excluido con motivo** |
| 10 | `TipoManoDominante` | (d) sin contraparte | — | en la lista justificada |
| 11 | `TipoModalidad` | (d) sin contraparte | — | en la lista justificada |
| 12 | `TipoEscuela` | (d) sin contraparte | — | en la lista justificada |
| 13 | `NivelTecnicoAlumno` | (d) sin contraparte | — | en la lista justificada |
| 14 | `EfectoCoberturaCorreccion` | (d) sin contraparte | — | en la lista justificada |

`Categoria` se excluye por el mismo criterio —y sobre el mismo enum— con que
`backend/tests/test_drift_enums_postgres.py:70` lo excluye en
`_ENUMS_SIN_COLUMNA_POSTGRES`: la tabla `categoria_horario` es la fuente de
verdad (`enums.py:56-65`), y `services/categorias.ts:32` declara `string` **a
propósito** para que un código que un admin agrega sin deploy no se descarte en
silencio. Exigir una biyección ahí congelaría justo lo que se decidió no
congelar.

### Los dos mapas de rol

`TipoRol` es el caso que más se parece al bug que originó
`tipo-notificacion-parity.test.ts`. Hay **dos** mapas a mano, en dos archivos,
que hoy dicen lo mismo — y no están tipados igual:

- `USER_ROLE_BY_BACKEND_ROLE` es `Record<BackendTipoRol, UserRole>`. TypeScript
  no compila un `Record` parcial: agregar un rol a la unión **rompe el build**
  de ese archivo, que es el aviso.
- `BACKEND_ROLE_TO_USER_ROLE` es `Record<string, UserRole>`, exhaustivo sobre
  nada. El mismo rol nuevo compila sin ruido, sale `undefined` en
  `lib/server/auth.ts:717` y lo descarta el `.filter` de la línea siguiente.

O sea: un rol agregado al backend **detiene el build por el camino del cliente y
desaparece callado por el del servidor**. Verificar el conjunto de claves contra
el enum de Python es exactamente lo que el tipo `Record<string, …>` no puede
verificar. El gate además compara los dos mapas entre sí, porque son dos copias
a mano de la misma tabla y nada en el sistema de tipos las relaciona.

`"unsupported"` (`types/domain.ts:48`) no participa: no es un rol que el backend
emita, es el centinela que devuelve `resolveSessionRole` (`lib/server/auth.ts:723`)
cuando ningún rol conocido matcheó.

## Divergencias inventariadas (sin corregir — issue [#935](https://github.com/AlejandroTatum/cata_club/issues/935))

Una biyección estricta se pone **roja hoy** por dos valores. Este PR los
**inventaría, no los arregla**: cerrarlos obliga a elegir un tono de badge y una
etiqueta visible, y eso es una decisión de producto que un PR de tests no toma.

| # | Enum | Valor | Lo agregó | El frontend declara | Destino |
| --- | --- | --- | --- | --- | --- |
| 1 | `EstadoMembresia` | `SUSPENDIDA` (`enums.py:39`) | issue [#400](https://github.com/AlejandroTatum/cata_club/issues/400) | sólo `"INACTIVA" \| "ACTIVA" \| "VENCIDA"` (`lib/membership-status.ts:9`) | issue #935 |
| 2 | `TipoPago` | `REGULARIZACION` (`enums.py:91`) | issue [#284](https://github.com/AlejandroTatum/cata_club/issues/284) | sólo `"EFECTIVO" \| "TRANSFERENCIA"` (`lib/server/payments-adapter.ts:23`) | issue #935 |

La exención es **por valor, nunca por enum**. Es la diferencia entre inventariar
una deriva y esconder la siguiente:

- `SUSPENDIDA` está exenta, así que el gate está verde hoy.
- Un tercer valor en **ese mismo enum** lo pone rojo igual. Hay un test que lo
  demuestra, y es el más importante de este contrato.
- Una exención que ya no tapa nada —porque alguien cerró #935— también pone el
  gate rojo, con el mensaje de que hay que borrarla. El inventario no
  sobrevive a su propia deriva.

## Los campos obligatorios

No se intenta leer el cuerpo de un type guard arbitrario. Se declara la tabla
explícita `CAMPOS_OBLIGATORIOS`, con la misma convención que `USOS_BACKEND` en
el gate del glosario (#903): cada fila dice qué campo exige un validador del BFF
y en qué DTO de Pydantic tiene que existir. El ejemplar es `isPublicSchedules`
(`frontend/src/app/api/schedules/route.ts:7`), cuyo comentario de las líneas
13-17 —«anything else here means the upstream shape moved, and the landing must
not render a guess at it»— es exactamente el razonamiento que la tabla mecaniza.

Cubre `isBackendLoginResponse`, `isBackendMeResponse`, `isBackendRefreshResponse`
(`lib/server/auth.ts:225,235,249`), `isBackendEnrollmentResponse`
(`lib/server/enrollment-adapter.ts:144`), `isBackendChatbotResponse`
(`app/api/chatbot/route.ts:64`) e `isPublicSchedules`.

Se verifican dos cosas por fila, y la segunda es la que atrapa un bug real:

1. **Que el campo exista** en el DTO, comparando por nombre Python.
2. **Que la convención del nombre sea la correcta.** `ResponseBase`
   (`schemas/base.py:45`) trae un `alias_generator` snake→camel y FastAPI
   serializa por alias, pero **sólo cuando la ruta declara `response_model=`**.
   Las dos condiciones son necesarias, y las tres combinaciones que importan
   existen de verdad:

| Ruta | ¿`response_model=`? | ¿hereda `ResponseBase`? | Viaja |
| --- | --- | --- | --- |
| `/auth/me` | sí | sí | `personaId` |
| `/enrollment/` | sí | no (`EnrollmentResponseDTO(BaseModel)`) | `persona_id` |
| `/auth/login`, `/auth/refresh` | no | sí | `access_token` |

Que `/login` y `/refresh` devuelven el dict OAuth2 crudo lo dice el propio
backend, en el docstring de `InvalidarSesionesResponseDTO`
(`auth_schemas.py:171-173`), y el frontend lo repite en `auth.ts:190-194`.

### El peligro que este gate ya atrapó: `response_model=` en `/login`

Esta comprobación no es hipotética. Se probó contra el código real y encontró un
peligro latente que hoy nada más detendría.

**La mutación.** Agregarle a `/login` el `response_model` que hoy no tiene:

```diff
-@router.post("/login")
+@router.post("/login", response_model=LoginResponseDTO)
```

Es un cambio que parece una mejora. `LoginResponseDTO` ya existe, ya describe
exactamente lo que la ruta devuelve, y declararlo es lo que hacen casi todas las
demás rutas del proyecto. Un revisor lo aprobaría sin dudar: agrega tipado y
documentación en Swagger, y no toca ninguna línea de lógica.

**Lo que rompe.** `LoginResponseDTO` hereda `ResponseBase`, así que en cuanto la
ruta declara `response_model=`, FastAPI serializa por alias y los tres campos
salen camelizados:

| Antes | Después |
| --- | --- |
| `access_token` | `accessToken` |
| `refresh_token` | `refreshToken` |
| `token_type` | `tokenType` |

`isBackendLoginResponse` (`lib/server/auth.ts:225`) exige `access_token` y
`refresh_token` en snake_case. Con la respuesta camelizada el validador devuelve
`false`, el login falla como `invalid_response` y **nadie puede entrar a la
aplicación**. No es una degradación parcial: es la autenticación entera.

**Por qué nada lo habría visto.** El backend sigue coherente consigo mismo y sus
tests pasan: devuelve lo que su DTO declara. El frontend sigue coherente consigo
mismo y sus tests pasan: los fixtures están escritos en snake_case, que es lo que
la ruta devolvía cuando se escribieron. La incompatibilidad vive **entre** los
dos, exactamente donde ninguna de las dos suites mira, y el tipo de TypeScript no
puede verla porque del otro lado hay Python. Se descubre abriendo la pantalla de
login — en staging si hay suerte, en producción si no.

**Por qué el gate sí lo ve.** Porque no compara nombres contra nombres, sino el
nombre que el BFF exige contra la **convención en la que ese campo viaja**, y esa
convención la deriva de las dos condiciones de arriba leídas del código: si la
ruta declara `response_model=` y si el DTO hereda `ResponseBase`. La mutación
cambia la primera, el gate lo nota y pone **tres tests en rojo** —uno por campo—
nombrando la ruta, el validador y el campo:

```
AssertionError: /auth/login: `isBackendLoginResponse` exige `access_token` pero el campo viaja camelizado
AssertionError: /auth/login: `isBackendLoginResponse` exige `refresh_token` pero el campo viaja camelizado
AssertionError: /auth/login: `isBackendLoginResponse` exige `token_type` pero el campo viaja camelizado
```

El arreglo correcto, si alguien quiere ese `response_model`, es declararlo **y**
actualizar el validador del BFF a los nombres camelizados. El gate no prohíbe el
cambio: obliga a hacer las dos mitades juntas.

## Alcance y continuación

Es continuación explícita del gate del glosario:
[`glossary-contract.md`](glossary-contract.md) declara en la fila 5 de sus
divergencias inventariadas que las superficies de badges (`status-badges.ts`,
`membership-status.ts`) «no están cubiertas por este gate» y quedan para un
issue hijo del frontend. Este contrato extiende esa cobertura por el lado de las
rutas en vez de duplicarla — y ahora también por el de los enums: las dos
superficies que esa fila 5 nombra son, exactamente, las filas 4 y 6 de la tabla
de enums de más arriba.

Lo que este gate **no** verifica es la *copy* visible de un estado: que
`EstadoPago.RECHAZADO` se muestre con determinado texto y tono es el gate del
glosario y el issue hijo de frontend, no éste. Acá se compara el conjunto de
valores, no cómo se dibujan.

## Cómo se corre

```bash
cd backend && uv run pytest ../tests/test_bff_contract.py -v
```

Offline: sin Postgres, sin Docker, sin servidor de desarrollo y sin red. Lee los
routers y los handlers como texto, igual que `tests/test_glossary_contract.py`
lee el glosario. Si alguna vez necesitara importar la aplicación FastAPI, el
diseño estaría mal: la suite de raíz corre en CI sin bloque `env:`.
