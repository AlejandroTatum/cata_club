# Cata Club Backend

Arquitectura de software limpia por capas (Dominio, Infraestructura, Servicios de Negocio, Seguridad y Presentación), alineada al diagrama de clases UML del proyecto, con patrón **Repository + Service Layer**.

## Tecnologías
Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2, PostgreSQL, Alembic, PyJWT & Passlib, uv, pytest.

## Instalación y Gestión de Dependencias
```
git clone [URL]
cd product-admin-backend
uv sync                  # Instala dependencias y crea entorno .venv
cp .env.example .env     # Configurar DATABASE_URL y JWT_SECRET_KEY
uv run uvicorn main:app --reload
```

## Estructura del Proyecto
```
app/
 ├── presentacion/         # Routers y Schemas (DTOs) — CERO SQL, cero lógica de negocio
 │    ├── routers/         # auth, personas, membresias_pagos, asistencias, ficha_medica,
 │    │                    # geografia, ranking, enrollment, dashboard, chatbot
 │    └── schemas/         # DTOs Pydantic por dominio
 ├── servicios_negocio/    # Reglas de negocio. Usa repositorios, NO conoce FastAPI/SQLAlchemy.
 │                         # Lanza excepciones de dominio (app/dominio/excepciones.py)
 ├── seguridad/            # Autenticación JWT y hashing (bcrypt)
 ├── dominio/               # Entidades ORM (modelos.py), enums.py, excepciones.py
 ├── infraestructura/
 │    ├── db.py             # Conexión y sesión de BD
 │    └── repositorios/     # ÚNICA capa que ejecuta db.query/add/commit
 └── soporte_transversal/  # Configuración centralizada (.env)
tests/                     # Suite pytest (SQLite en memoria, no requiere Postgres)
```

**Flujo de una petición:** Router recibe el DTO → instancia el Servicio pasándole la sesión →
el Servicio aplica reglas de negocio y llama al Repositorio → el Repositorio ejecuta SQLAlchemy
→ si algo falla, el Servicio lanza una excepción de dominio → un manejador global en `main.py`
la traduce al código HTTP correspondiente. El router nunca ve `HTTPException` ni `db.query`.

## Modelo de Dominio (21 entidades)
Pais → Provincia → Canton → Direccion · Institucion · Rol · Usuario · **Persona** (relación
reflexiva Representante/Representados) · AntecedentesClub · TipoMembresia · Membresia · Pago ·
ComprobantePago · NivelRanking · **HorarioEntrenamiento** (con entrenador titular) ·
**Asistencia** (con entrenador de la sesión, puede ser un sustituto) · AlumnoHorario ·
FichaMedica · Enfermedades · Ranking · Notificacion.

### Correcciones aplicadas sobre el diagrama original
| Relación | Diagrama original | Corregido a | Motivo |
|---|---|---|---|
| Rol ↔ Usuario | `1..*` / `0..*` | `0..*` / `0..*` | Un rol puede crearse sin usuarios asignados aún |
| Persona ↔ Direccion | `1` obligatorio | `0..1` | Permite compartir dirección o no registrarla |
| Pago ↔ Membresia | Composición (◆) | Asociación simple | El historial de pagos no debe borrarse en cascada |
| FichaMedica ↔ Enfermedades | `1..*` | `0..*` | Una persona sin enfermedades no debe forzar el registro de una |
| Pago → Persona | No existía en el diagrama | Agregada | Ya estaba en el modelo ORM base; se hizo trazable |
| `EstadoMembresia` (D11) | Incluía `PENDIENTE_PAGO`, mezclando el ciclo de vida de `Pago` dentro de `Membresia` | `INACTIVA \| ACTIVA \| VENCIDA` | Dos objetos con ciclos de vida distintos no deben compartir estados |
| `HorarioEntrenamiento` (D23) | Sin día de la semana | Se agregó `dia_semana: DiaSemana` | Un horario "10:00–11:00" era ambiguo sin el día |

### Reglas de negocio confirmadas e implementadas
| Requisito | Implementación |
|---|---|
| Entrenador fijo por horario, pero puede cambiar (sustitución) | `HorarioEntrenamiento.entrenador_id` = titular fijo. `Asistencia.entrenador_id` = quien dictó *esa* sesión puntual (puede diferir del titular). Ambos se validan contra personas con rol `ENTRENADOR` real vía `AsistenciaServicio._validar_entrenador`. |

**Descartado deliberadamente** (no son huecos, son alternativas de diseño sin necesidad de negocio confirmada): tipar `formatoArchivo` como enum, entidad `Grupo`.

## Pruebas
Suite de **218 pruebas automatizadas** con `pytest` + `TestClient`, usando SQLite
en memoria (no requiere PostgreSQL para correr). Cubre: CRUD de Persona y
relación reflexiva de representante, permisos por rol (403), la corrección de
estados Membresía↔Pago, validación de rol ENTRENADOR real, sustitución de
entrenador en Asistencia, subida de voucher de transferencia (JPG/PDF),
registro de usuario para persona ya existente, refresh de tokens (incluido el
rechazo al mandar access en vez de refresh), CRUD de geografía
(País/Provincia/Cantón con filtros y permisos admin), ranking (niveles,
asignaciones, movimientos de nivel, notificaciones), autoinscripción
(enrollment), dashboard de estadísticas y chatbot de FAQ.

```
uv run pytest tests/ -v --cov=app --cov-report=term-missing
```
Resultado: **218 passed**, 0 errores, solo advertencias de deprecación internas de
librerías de terceros (FastAPI/Starlette), no del código propio.

## Estado Actual
Implementado: Modelo de dominio completo (21 entidades), DTOs por dominio,
Routers CRUD, Autenticación JWT + login + registro + me + refresh + logout +
recuperación/restablecimiento de contraseña, Gestor de permisos por rol,
patrón Repository + Service Layer, manejo global de excepciones de dominio,
suite de pruebas automatizadas, voucher de cliente (imagen/PDF en Cloudinary
con carpeta separada), CRUD de geografía (País/Provincia/Cantón), ranking de
alumnos (niveles, asignaciones, movimientos, notificaciones), autoinscripción
(enrollment), dashboard de estadísticas, chatbot de FAQ (DeepSeek vía gateway
OpenAI-compatible), base Alembic inicializada con historial de migraciones del
esquema completo.

### Implementado en esta iteración
| Cambio | Detalle |
|---|---|
| Voucher de transferencia (cliente) | 3 columnas nuevas en `Pago` (`voucher_url`, `voucher_formato`, `voucher_fecha_carga`). Endpoint `POST /membresias/pagos/{id}/voucher` con validación de estado, permisos (dueño o admin) y tipo/tamaño de archivo. Subida a Cloudinary (carpeta `cataclub/vouchers`) con `overwrite` para permitir re-corrección del voucher mientras el pago siga `PENDIENTE_VALIDACION`. `ComprobantePago` **NO** se toca (sigue siendo el PDF oficial generado por Celery al aprobar). |
| Registro de usuario (público) | `POST /auth/registro` crea el `Usuario` (credenciales) para una `Persona` ya existente (no crea Persona; el alta de Persona sigue siendo exclusiva de admin vía `POST /personas`). Auto-login: devuelve `access_token` + `refresh_token`. Sin roles asignados (asignación perezosa coherente con el resto del sistema). |
| Perfil del usuario autenticado | `GET /auth/me` devuelve correo, persona_id, nombres, apellidos y roles actuales. |
| Refresh token | `POST /auth/refresh`: recibe refresh token en el body (no en header), valida `type=refresh`, reemite access token con roles ACTUALES del usuario. `POST /auth/logout` stateless (el cierre real ocurre en el frontend borrando cookies httpOnly — no hay blacklist; ver limitación documentada). |
| JWT claims | `type=access` en access tokens, `type=refresh` en refresh tokens (vida configurable `JWT_REFRESH_EXPIRA_DIAS`). |
| CRUD de Geografía | País/Provincia/Cantón con repositorios, servicios y routers nuevos (mismo patrón que personas). `provincias?pais_id=` y `cantones?provincia_id=` con filtros opcionales. POST exige admin; GET es de lectura general. |
| Migraciones Alembic | Carpeta `alembic/` inicializada + primera migración autogenerate (`esquema inicial + voucher en pago`) que captura las 20 tablas (19 entidades + `usuario_rol`) incluyendo enums, FKs, unique constraints y las 3 columnas nuevas de voucher. No se ejecutó `upgrade head` (fase posterior, al conectar PostgreSQL). |

### Pendiente 
Endpoints CRUD de Direccion e Institucion (mismo patrón que geografía), rotación/blacklist
de refresh tokens (ver `AuthServicio.refrescar_sesion`).

## Endpoints disponibles (80)
Ejecutar el servidor y visitar `/docs` para el Swagger interactivo. Resumen por router (todos montados bajo `/api/v1`):
- **Auth** (9): `POST /auth/login`, `POST /auth/registro`, `GET|PATCH /auth/me`, `POST /auth/me/foto`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/recuperar-contrasenia`, `POST /auth/restablecer-contrasenia`
- **Personas** (19): `POST|GET /personas/`, `GET /personas/reportes/nuevos-por-periodo`(+`/pdf`), `GET /personas/entrenadores`, `GET /personas/buscar`, `GET|PATCH|DELETE /personas/{id}`, `GET|POST /personas/{id}/representados`, `GET|POST|PATCH /personas/{id}/antecedentes-club`, `GET|POST /personas/{id}/roles`, `DELETE /personas/{id}/roles/{tipo_rol}`, `PATCH /personas/{id}/cuenta/estado`, `PATCH /personas/{id}/nivel`
- **Membresías y Pagos** (17): `GET|POST /membresias/tipos`, `GET|POST /membresias/`, `GET /membresias/mias`, `GET /membresias/persona/{id}`, `GET /membresias/estadisticas`, `GET /membresias/{id}`, `GET|POST /membresias/pagos`, `GET /membresias/pagos/reportes`(+`/pdf`), `GET|PATCH /membresias/pagos/{id}`(`/validar`), `GET /membresias/pagos/persona/{id}`, `POST /membresias/pagos/{id}/comprobante`, `POST /membresias/pagos/{id}/voucher`
- **Asistencias** (12): `POST|PUT|DELETE /asistencias/horarios`(`/{id}`), `GET|POST /asistencias/`, `GET /asistencias/persona/{id}`, `GET /asistencias/reportes`(+`/pdf`), `POST|DELETE /asistencias/asignar-alumno`(`/desasignar-alumno`), `GET /asistencias/horarios/{id}/alumnos`, `GET /asistencias/alumnos/{persona_id}/horarios`
- **Ranking** (7): `GET|POST /ranking/niveles`, `GET /ranking/asignaciones`, `GET /ranking/niveles/{id}/tabla`, `GET /ranking/{persona_id}/perfil`, `GET /ranking/notificaciones/mias`, `PATCH /ranking/notificaciones/{id}/leer`
- **Geografía** (9): `GET|POST /geografia/paises`(`/{id}`), `GET|POST /geografia/provincias`(`/{id}`), `GET|POST /geografia/cantones`(`/{id}`)
- **Ficha Médica** (3): `POST|GET|PATCH /fichas-medicas/`(`/persona/{id}`)
- **Enrollment** (1): `POST /enrollment/`
- **Dashboard** (1): `GET /dashboard/stats`
- **Chatbot** (1): `POST /chatbot/consultar`