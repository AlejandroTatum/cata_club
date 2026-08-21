# Provisioning — Droplet DigitalOcean para producción

> **Estado:** Activa (guía; no ejecutada contra un entorno real — el runbook de
> despliegue ([`deployment.md`](deployment.md)) es la fuente de los pasos 5+)
>
> **Responsable:** Infraestructura + el operador con acceso al host
>
> **Última verificación:** 2026-08-17 · **Acuerdos previos:** la cuenta debe ser
> del club (ver [`../product/acuerdo-de-servicio.md`](../product/acuerdo-de-servicio.md),
> cláusula 7, y la decisión del 17-ago en
> [`../product/decision-cuenta-proveedor-2026-08-17.md`](../product/decision-cuenta-proveedor-2026-08-17.md))

Esta guía lleva el droplet de "cuenta recién creada" a "host listo para
`deploy.sh`". Presupuesto del stack: **2GB / 1 vCPU / 50GB** (ver
[`../product/propuesta-de-servicio.md`](../product/propuesta-de-servicio.md)) y
memoria por servicio ya acotada en `docker-compose.prod.yml` (1536m de 2048m).
**No** construir imágenes en el host: el build del frontend OOMó un droplet de
2GB (evidencia en el runbook de despliegue); las imágenes se publican en GHCR.

## Convención de rutas del host (fija, la usan los scripts)

| Ruta | Para qué |
|---|---|
| `/opt/cata-club` | El repo (clone de `origin/main`) |
| `/opt/cata-club/.env` | Variables de producción (chmod 600, nunca en git) |
| `/opt/cata-club/scripts/` | `deploy.sh`, `backup/*.sh`, `ops/*.sh` |
| `/var/backups/cataclub` | Dumps lógicos diarios |
| `/var/log/cataclub-backup.log` | Log del cron de backup |

## 1. Crear el droplet

1. Cuenta de DigitalOcean **a nombre del club** (medio de pago del club).
2. Imagen: **Ubuntu 24.04 LTS x64**. Plan: **Basic — 2GB / 1 vCPU / 50GB**.
3. Región: la más cercana al club. Nada más.
4. SSH: **agregar la key del operador** (o generar una nueva y guardar la privada
   bajo llave; la passphrase es obligatoria).
5. **Backups diarios activados** (30% del costo, ya presupuestados — capa L1).
6. Hostname: `prod-cataclub` (o similar).

## 2. Primer acceso y hardening

```bash
ssh root@<ip-del-droplet>
# Primeros pasos
apt-get update && apt-get upgrade -y

# Swap de emergencia: el presupuesto deja margen, pero un pico del OS no debe
# matar un contenedor. 2GB en disco, nunca se toca en operación normal.
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall: SOLO 22/80/443. El backend y la base NUNCA se exponen.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable && ufw status verbose
```

Hardening de SSH (editar `/etc/ssh/sshd_config`):

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

`systemctl restart ssh`. **Cerrar la sesión de prueba ANTES de seguir**: si la
key no funciona, no quedarse afuera.

## 3. Docker + Compose

```bash
# Instalación oficial (repo de Docker, no el paquete snap de Ubuntu)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Compose plugin viene con get.docker.com; verificar
docker compose version          # Docker Compose version v2.x
```

## 4. El repo y el .env

```bash
git clone https://github.com/AlejandroTatum/cata_club.git /opt/cata-club

# Plantilla de producción: copiar, completar TODOS los valores, chmod 600
cp /opt/cata-club/.env.production.example /opt/cata-club/.env
chmod 600 /opt/cata-club/.env
nano /opt/cata-club/.env
```

El `.env` de producción necesita (ver
[`../reference/configuration.md`](../reference/configuration.md)):
`IMAGE_TAG` (SHA), `AMBIENTE=production`, `DOMINIO`, `ACME_EMAIL`,
`JWT_SECRET_KEY`, credenciales de Postgres, `CORS_ORIGENES`, SMTP de Resend,
`FRONTEND_URL`, las 3 de Cloudinary, y `OPENCODE_API_KEY` si el chatbot va.

## 5. Acceso a GHCR (paquetes privados)

El registro `ghcr.io/alejandrotatum/*` es **privado** (verificado 2026-08-17,
HTTP 401 anónimo). Dos caminos — **decidir uno**:

- **A. PAT con `read:packages` (recomendado, sin tocar el repo):** el operador
  crea un token de GitHub con scope `read:packages` y hace login en el host:
  ```bash
  echo "$PAT" | docker login ghcr.io -u <usuario-github> --password-stdin
  ```
  El login expira; documentar la renovación periódica en el calendario del
  operador (o usar un PAT classic sin expiración, guardado bajo llave).
- **B. Publicar los paquetes GHCR:** en GitHub → Packages → cada imagen →
  Settings → Change visibility → Public. Cero credenciales en el host, pero
  cualquiera puede bajar las imágenes (no el código de `main`, que ya es
  público de todas formas).

## 6. Instalar el cron de backup y desplegar la primera vez

```bash
cd /opt/cata-club
./scripts/deploy/deploy.sh install-cron   # idempotente; ya no se repite
# Fijar el SHA a desplegar (verificar antes: docker manifest inspect) y desplegar
IMAGE_TAG=<sha-completo> ./scripts/deploy/deploy.sh
```

El primer despliegue dispara la emisión del certificado de Let's Encrypt vía
Caddy. **El registro DNS debe apuntar YA al droplet** (registro A del dominio →
IP) antes de levantar, o Caddy fallará la emisión (tiene límites de tasa).

## 7. Verificación final

- `deploy.sh` corre las 4 validaciones del runbook al terminar.
- Confirmar el sitio en https://<DOMINIO> con TLS.
- Ejecutar la verificación de restore del backup (ver
  [`backup-restore.md`](backup-restore.md)) contra un dump real: es lo que pasa
  la fila de readiness a *Ready*.

## DNS (una vez)

| Tipo | Nombre | Valor |
|---|---|---|
| A | `<dominio>` (o subdominio) | IP del droplet |

Subdominios: si se usa `app.cataclub.com`, el `DOMINIO` del `.env` y el `CORS_ORIGENES`
deben usar exactamente ese host — sin www. (Caddy emite el certificado solo para
el host configurado.)

## Lo que NO hay que hacer

- **No** correr `docker compose build` en el host (OOM medido; builds en GHCR).
- **No** exponer puertos del backend ni de la base (solo Caddy publica 80/443).
- **No** desplegar con `latest` (`deploy.sh` lo rechaza).
- **No** guardar el `.env` fuera de `/opt/cata-club` ni con permisos amplios.