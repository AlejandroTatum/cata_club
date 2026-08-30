# Réplica del backup fuera del host (Backblaze B2)

El backup local ya sale cifrado de `backup-db.sh`, pero vive en el **mismo
disco** que la aplicación (`/var/backups/cataclub`). La pérdida total del
droplet —borrado accidental, cuenta suspendida, disco muerto, ransomware— se
lleva el padrón completo del club y ningún control local puede hacer nada al
respecto. Es el follow-up 3 de [`monitoring.md`](monitoring.md).

`scripts/backup/upload-b2.sh` copia el artefacto **ya cifrado** a un object
store S3-compatible y verifica que del otro lado quedó algo íntegro y
direccionable. Lo invoca `backup-db.sh` al final de cada corrida.

## Qué sale del host, y qué no

Lo que viaja es exactamente el `.dump.age` que quedó en disco. El host solo
tiene el **destinatario** `age` (clave pública), así que ni el proceso que
escribe el backup ni el que lo replica pueden leerlo. La identidad `age`
privada no vive acá y no participa de este camino.

De ahí sale la propiedad que hace que esto sea seguro: **un bucket comprometido
no es una fuga del padrón.** B2 recibe texto cifrado y nada más.

El uploader rechaza cualquier otra cosa. Un `.dump` es el padrón en claro y un
`.dump.age.tmp` es un dump a medio escribir: ninguno de los dos sale del host,
y el rechazo ocurre antes de tocar la red.

## Configuración en el host

Toda la configuración va en **un archivo**, no en el entorno. El cron corre con
un entorno mínimo y no hereda el shell del operador: una réplica activada con
un `export` en la terminal estaría activada exactamente en la sesión donde
nadie la necesita, y apagada todas las noches a las 03:30 sin que nada lo diga.
Es el mismo reparto que `backup-recipients.txt`.

```bash
ssh <host>
sudo apt-get install -y awscli
sudo install -d -m 700 /etc/cataclub
sudo install -o root -g "$(id -gn)" -m 640 /dev/null /etc/cataclub/b2-backup.env
sudo tee /etc/cataclub/b2-backup.env >/dev/null <<'EOF'
BACKUP_B2_ENABLED=1
BACKUP_B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_B2_REGION=us-west-004
BACKUP_B2_BUCKET=cataclub-prod-backups-loja-ec
BACKUP_B2_PREFIX=cataclub/produccion
BACKUP_B2_KEY_ID=<application-key-id>
BACKUP_B2_APPLICATION_KEY=<application-key>
EOF
```

- Permisos `640` y dueño root, igual que `heartbeat-url.txt`: el usuario que
  corre el cron necesita leerlo; nadie más en el host tiene por qué.
- El endpoint y la región salen de la pantalla del bucket en B2. La región es
  la que aparece dentro del endpoint (`s3.<region>.backblazeb2.com`).
- El archivo se **parsea** `CLAVE=valor`; no se hace `source`. Una línea de más
  no se ejecuta.

Verificar sin tocar la red ni subir nada:

```bash
./scripts/backup/upload-b2.sh --check-config
```

`install-cron` corre esa misma verificación y **aborta** si la réplica está
activada y le falta algo: no se instala un cron que no replicaría nada.

> **No copiar este archivo a otro entorno.** Un staging apuntado al bucket de
> producción ensucia el histórico del que depende la recuperación real, y con
> Object Lock activo esos objetos **no se pueden borrar** hasta que venza la
> retención. El uploader tiene una compuerta para ese error concreto
> (`BACKUP_B2_PRODUCTION_BUCKET`), pero la compuerta no reemplaza a la regla:
> cada entorno necesita su propio bucket y su propia application key.

## Configuración en B2 (fuera de este repositorio)

El bucket y sus políticas se administran en B2, no desde acá. Un script que
pudiera borrar objetos remotos anularía justamente la propiedad por la que la
copia está fuera del host, así que `upload-b2.sh` **solo escribe**.

| Qué | Valor | Por qué |
| --- | --- | --- |
| Object Lock | activado, retención por defecto **30 días** | Un atacante con la credencial del host no puede borrar ni sobrescribir el histórico reciente. |
| Lifecycle | conservar ~**90 días** en total, después eliminar | Techo de costo y de exposición; el RPO real lo sigue dando el backup diario. |
| Visibilidad | privado | — |

### Application key

Crear una key **restringida a ese único bucket**. Capacidades necesarias, en
términos de la API S3 que usa el script:

| Operación S3 | Para qué la usa el script | Capacidad B2 |
| --- | --- | --- |
| `PutObject` | subir el `.dump.age` | `writeFiles` |
| `HeadObject` | verificar tamaño y el metadato `sha256` | `readFiles` |
| `ListObjectsV2` | verificar que la clave es direccionable | `listFiles` |

**No** conceder `deleteFiles`. El host no tiene por qué poder destruir su
propio histórico, y junto con Object Lock eso es lo que convierte la copia en
una defensa real contra un compromiso del droplet. (Confirmar los nombres
exactos de las capacidades en la consola de B2 al crear la key: son las tres de
lectura/listado/escritura sobre un solo bucket, sin borrado.)

## Qué verifica la réplica

Un `put-object` que sale 0 dice que la llamada no falló, no que del otro lado
quedó un objeto íntegro. Después de subir, el script compara tres evidencias
independientes contra el artefacto local:

1. **Tamaño** — `ContentLength` del HEAD contra los bytes locales.
2. **Contenido** — metadato `sha256`, que sube el mismo script, contra el
   sha256 local.
3. **Direccionabilidad** — la clave aparece en el listado del prefijo, que es
   como se va a encontrar el backup el día del desastre.

El **ETag no se usa como checksum**: para una subida multiparte no es el MD5
del contenido, ni en S3 ni en B2. Un control apoyado en él estaría comparando
algo que no es el hash del dato.

Cualquiera de las tres que falle aborta con salida distinta de cero. El
artefacto local ya escrito **se conserva**: borrarlo cambiaría una falla de
réplica por una pérdida de datos. La retención local no cambia en nada.

## Restaurar desde la réplica

La identidad `age` privada **no vive en el droplet**. La restauración se hace
en la máquina de quien opera, que es donde está la identidad.

```bash
# 1. Ver qué hay
aws s3api list-objects-v2 \
  --endpoint-url https://s3.us-west-004.backblazeb2.com \
  --region us-west-004 \
  --bucket cataclub-prod-backups-loja-ec \
  --prefix cataclub/produccion/ \
  --query 'Contents[].[Key,Size,LastModified]' --output table

# 2. Bajar el artefacto elegido
CLAVE=cataclub/produccion/cataclub_2026-08-29.dump.age
aws s3api get-object \
  --endpoint-url https://s3.us-west-004.backblazeb2.com \
  --region us-west-004 \
  --bucket cataclub-prod-backups-loja-ec \
  --key "$CLAVE" \
  ./cataclub_2026-08-29.dump.age

# 3. Comprobar que bajó entero, contra el metadato que subió el uploader
aws s3api head-object \
  --endpoint-url https://s3.us-west-004.backblazeb2.com \
  --region us-west-004 \
  --bucket cataclub-prod-backups-loja-ec \
  --key "$CLAVE" --query 'Metadata.sha256' --output text
sha256sum ./cataclub_2026-08-29.dump.age

# 4. Restore verificado en un entorno desechable (descifra con la identidad
#    privada y valida alembic_version + conteos contra un Postgres efímero)
./scripts/backup/restore-check.sh ./cataclub_2026-08-29.dump.age \
  --identity ./identidad-backup-cataclub.txt
```

El paso 4 prueba, además, que la identidad guardada sigue siendo la correcta y
sigue siendo legible. Una clave que nadie ejercitó es una clave que no se sabe
si existe: conviene correrlo periódicamente, no solo el día del desastre.

## Lo que esta pieza todavía NO cubre

**El monitoreo externo no observa la réplica.** Si la subida falla,
`backup-db.sh` sale distinto de cero a las 03:30, pero el artefacto local queda
escrito y fresco; el chequeo de las 07:00 (`check-backup-freshness.sh`) mira el
disco local, lo ve fresco y **pingea el heartbeat igual**. El monitor externo se
queda en verde con la réplica muerta.

Hoy la evidencia está solo en `BACKUP_CRON_LOG`. Cerrar eso pide que la señal
de frescura contemple el estado de la réplica, y no es parte de este cambio.

## Referencias

- [`provisioning.md`](provisioning.md) — cifrado del backup, crons, restore.
- [`monitoring.md`](monitoring.md) — monitores externos y follow-ups.
- `scripts/backup/upload-b2.sh` — el uploader y el porqué de cada control.
