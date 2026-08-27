# Monitoring y alertas

Los controles locales exponen señales, no un proveedor de monitoreo. La
configuración de alertas externas y la réplica off-host siguen siendo decisiones
del operador/proveedor.

## Señales disponibles

- `scripts/ops/check-backup-freshness.sh --max-age-hours 26` sale `0` si existe
  un dump reciente, `1` si no existe y `2` si supera el RPO.
- `scripts/ops/preflight-production.sh` valida la configuración de Compose y la
  frescura del backup antes de un release.
- `scripts/deploy/deploy.sh checks` ejecuta las sondas internas de health y
  readiness, confirma que `/docs` no quedó expuesto y vuelve a comprobar el RPO.

Los comandos no envían correo, webhooks ni datos a terceros. Un scheduler del
host o un proveedor externo debe ejecutar el chequeo y enrutar su salida a un
canal de alerta.

## Follow-ups obligatorios antes de depender de producción

1. Configurar un monitor **fuera del host** contra el endpoint HTTPS público de
   readiness, con destinatarios y escalación definidos por el club.
2. Ejecutar `check-backup-freshness.sh` desde el scheduler elegido y probar una
   alerta por backup ausente/viejo.
3. Replicar los dumps a almacenamiento fuera del host y fijar allí la
   retención/lifecycle. El backup local no protege ante la pérdida total del
   host. Ya salen cifrados de `backup-db.sh` (`age`, destinatario público), así
   que se pueden replicar sin exponer el padrón; el destino igual necesita sus
   propios controles de acceso.
4. Probar restore en un entorno desechable antes de declarar recuperabilidad.
   Con artefactos cifrados hace falta la identidad privada:
   `restore-check.sh <dump>.dump.age --identity <archivo>`. Probarlo **también**
   verifica que la identidad guardada sea la correcta y siga siendo legible —
   una clave que nadie ejercitó es una clave que no se sabe si existe.

No instalar un monitor dentro del mismo host como sustituto del control externo:
una caída completa lo silenciaría junto con la aplicación.
