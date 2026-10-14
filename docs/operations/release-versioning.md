# Versionado de releases (SemVer)

La aplicación tiene **una sola versión**, `MAJOR.MINOR.PATCH`, y nace en cada
deploy a producción. La fuente de verdad es el tag de Git `vX.Y.Z`: ninguna
copia estática (`pyproject.toml`, `package.json`) es autoritativa. Producción
dice qué versión corre en `https://cataclub.com/api/health`:

```json
{"status":"ok","sha":"<IMAGE_TAG completo>","version":"1.4.0"}
```

Este documento complementa [production-cutover.md](production-cutover.md) y
[provisioning.md](provisioning.md#contrato-del-host); no los reemplaza.

## Quién hace qué

| Paso | Dónde | Quién |
| --- | --- | --- |
| Calcular la versión | máquina del dueño del repo | `make release-version` |
| Fijarla y desplegar | host de producción | operador, con `deploy.sh` |
| Etiquetar | máquina del dueño del repo | `make release-tag` |

**El host de producción nunca necesita credenciales de escritura en GitHub.**
Ni `deploy.sh`, ni `record-release.sh`, ni `rollback-release.sh` crean ni
suben tags: el único paso que escribe en GitHub corre en la máquina del dueño.

## Cómo se calcula la versión

`scripts/release/next-version.sh <sha>` toma el último tag `vMAJOR.MINOR.PATCH`
**alcanzable desde ese SHA** (un tag en otra rama no cuenta; los prereleases
como `v1.9.0-rc1` tampoco) y lee asunto y cuerpo de cada commit en
`<tag>..<sha>`:

| Si hay… | Sube |
| --- | --- |
| `!` antes de los dos puntos del asunto (`feat!:`, `fix(api)!:`) o un pie `BREAKING CHANGE:` / `BREAKING-CHANGE:` al inicio de una línea del cuerpo | **major** |
| si no, algún `feat` | **minor** |
| si no | **patch** |

Falla, sin imprimir una versión, si no hay ningún tag base (ver
[Arranque único](#arranque-único-el-tag-v130)) o si no hay commits desde él
(no hay nada que publicar).

## Flujo de cada release

1. **Calcular la versión** (máquina del dueño). Trae primero los tags para que
   el cálculo parta del último release real:

   ```bash
   git fetch --tags origin
   make release-version SHA=<sha-a-desplegar>
   # APP_VERSION=1.4.0
   ```

2. **Fijarla en el `.env` del host**, junto a `IMAGE_TAG` (el mismo `SHA`):

   ```bash
   cd /opt/cata-club
   sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha-a-desplegar>/" .env
   grep -q '^APP_VERSION=' .env \
     && sed -i "s/^APP_VERSION=.*/APP_VERSION=1.4.0/" .env \
     || echo 'APP_VERSION=1.4.0' >> .env
   grep -E '^(IMAGE_TAG|APP_VERSION)=' .env
   ```

3. **Desplegar** como siempre (ver [provisioning.md](provisioning.md#contrato-del-host)):

   ```bash
   export IMAGE_TAG="$(git rev-parse HEAD)"
   export MIGRATION_COMPATIBILITY=<none|backward-compatible|manual-review-required>
   ./scripts/ops/preflight-production.sh
   ./scripts/deploy/deploy.sh
   ```

   `deploy.sh deploy` valida `APP_VERSION` **antes de cualquier cambio**
   (backup, `pull`, `up`): debe ser `MAJOR.MINOR.PATCH`, solo dígitos y sin
   `v`. Si falta o está mal formada, se detiene sin tocar nada y apunta a
   `make release-version`. Al terminar, `record-release.sh` guarda
   `APP_VERSION` en el `.env` y en el registro de release (ledger).
   `deploy.sh checks` no la exige.

4. **Comprobar lo que sirve producción**:

   ```bash
   curl -fsS https://cataclub.com/api/health
   ```

   **Esperado:** el `sha` completo desplegado y la `version` del paso 1.

5. **Etiquetar** (máquina del dueño), apuntando al `/api/health` público:

   ```bash
   make release-tag SHA=<sha-desplegado> HEALTH_URL=https://cataclub.com/api/health
   ```

   `release-tag` recalcula la versión, consulta `HEALTH_URL` y **se niega sin
   crear nada** si el `sha` servido no es exactamente el SHA completo o si la
   `version` servida no es la calculada. Si coinciden, crea el tag anotado
   `vX.Y.Z` en ese SHA y sube **solo ese tag** (`git push origin
   refs/tags/vX.Y.Z`). Falla si el tag ya existe, localmente o en `origin`.

**Detente si:**

- `make release-tag` dice que el tag ya existe en `origin`: otro release se
  etiquetó antes. Ejecuta `git fetch --tags origin` y repite desde el paso 1;
  si la versión cambia, hay que volver a fijar `APP_VERSION` y redesplegar.
- El deploy falló: no etiquetes. Un release sin deploy exitoso no tiene
  versión; corrige hacia adelante y repite desde el paso 3 (el tag no existe,
  no hay nada que limpiar).

## Arranque único: el tag `v1.3.0`

Sin un primer tag, `make release-version` falla pidiéndolo. Es una acción
**única** del dueño, desde su máquina, sobre el SHA que corre hoy en
producción:

```bash
SHA_PROD="$(curl -fsS https://cataclub.com/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
git fetch origin
git cat-file -e "${SHA_PROD}^{commit}"   # debe existir en tu clon
git tag -a v1.3.0 "$SHA_PROD" -m "Release v1.3.0"
git push origin refs/tags/v1.3.0
```

Si `/api/health` de producción todavía no devuelve `sha` (versión previa a este
cambio), toma el SHA de `cat /var/lib/cata-club/releases/current.env` en el host.
`v1.3.0` es la versión que ya figuraba en el código; el primer release
versionado parte de ahí.

## Rollback

`rollback-release.sh <sha-anterior> --confirm-rollback` restaura también
`APP_VERSION` desde el registro del SHA destino, en el `.env` y en `pull`/`up`.
Los registros anteriores al versionado no la tienen: quedan en `unversioned`
(`/api/health` lo mostrará así). El rollback no crea ni borra tags: los tags
`vX.Y.Z` ya publicados son historia y no se reescriben.
