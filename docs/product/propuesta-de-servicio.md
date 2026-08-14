# Propuesta de servicio — alojamiento y mantenimiento

- **Derivado:** 11 de agosto de 2026 — actualizado el 13 de agosto de 2026
- **Estado:** **aceptado por el club el 13 de agosto de 2026**, incluidos los tres
  ajustes por crecimiento de la sección 4. Los términos pactados viven en
  [`acuerdo-de-servicio.md`](acuerdo-de-servicio.md); este documento conserva la
  derivación de dónde salen.
- **Precio vigente:** USD 35 / mes — USD 385 / año (11 meses abonados, 12 de servicio)
- **Para qué sirve este documento:** guardar el mensaje que se le envía al club
  y, sobre todo, **de dónde sale el número**. Un precio sin su derivación se
  vuelve indefendible en la primera objeción.

Los precios de proveedores se verificaron el 11 de agosto de 2026 contra las
páginas oficiales. **Re-derivalos antes de citarlos**: Hetzner subió entre 30% y
175% el 15 de junio de 2026 y invalidó una recomendación anterior de este mismo
relevamiento.

---

## 1. Desglose de costo — USO INTERNO, no se muestra al club

| Concepto | Mensual |
|---|---|
| Droplet DigitalOcean 2GB / 1 vCPU / 50GB | $12.00 |
| Respaldos automáticos diarios (30% del droplet) | $3.60 |
| Dominio `.com` (~$15/año prorrateado) | $1.25 |
| Resend — envío de correo (tier gratis) | $0.00 |
| Cloudinary — almacenamiento de archivos (tier gratis) | $0.00 |
| **Costo de infraestructura** | **$16.85** |
| Administración, actualizaciones y soporte | $18.15 |
| **Precio al club** | **$35.00** |

**Por qué el desglose no se muestra.** Una factura por línea invita a negociar
línea por línea: «¿y si respaldamos una vez por semana?», «¿y si usamos el
servidor más chico?». El club compra un servicio, no una lista de insumos. Un
precio, y la descripción de lo que protege.

### Por qué 2GB y no 4GB

El sistema levanta **7 contenedores** en producción (Postgres, Redis, backend,
celery-worker, celery-beat, frontend, Caddy). El más pesado es celery-worker:
`docker-compose.yml:152` corre `--concurrency=2`, es decir un proceso padre más
dos hijos, **cada uno con la aplicación entera cargada**.

Con esa configuración, 2GB no alcanza con margen. Con `--concurrency=1` más
límites de memoria por servicio, sí. Ese ajuste es la razón por la que el precio
puede sostener respaldo diario —lo único que importa de verdad— sobre la máquina
chica. Ver la sección 5.

### Por qué respaldo diario y no semanal

Cuesta **$1.20 más por mes** que el semanal (30% contra 20% del droplet). La
diferencia en un incidente es entre perder un día de movimientos o perder siete,
sobre datos que incluyen historial de pagos y fichas médicas de menores.

No hay ninguna lectura razonable en la que ahorrar $1.20 justifique ese riesgo.

---

## 2. El mensaje para el club

Texto listo para enviar. Está escrito **sin vocabulario técnico a propósito**: no
dice droplet, ni contenedor, ni base de datos. Un club no compra tecnología,
compra tranquilidad.

```
Estimados,

Les detallo el servicio y su costo.

USD 35 al mes — o USD 385 al año, abonando 11 meses y usando 12.

Qué incluye:

• El sistema completo funcionando en internet, accesible desde
  cualquier celular o computadora, las 24 horas.
• Dominio propio del club y conexión segura. Los datos de socios,
  pagos y fichas médicas viajan cifrados.
• Respaldo diario de toda la información. Ante una falla grave se
  pierde, como máximo, un día de movimientos.
• Avisos automáticos de vencimiento de mensualidad, dentro de la
  aplicación y por correo electrónico.
• Recuperación de contraseña por correo, sin que un administrador
  tenga que intervenir.
• Almacenamiento de comprobantes de pago, vouchers y fotos de perfil.
• Actualizaciones, correcciones y soporte del sistema.

Por qué el respaldo diario y no semanal:

El sistema guarda el historial de pagos y las fichas médicas de los
menores. Con respaldo semanal, una falla puede costar hasta siete
días de registros y obligar a pedirle a las familias que vuelvan a
presentar sus comprobantes. La diferencia de costo entre respaldar
una vez por semana y hacerlo todos los días es menor a USD 2 al mes.
No hay razón para asumir ese riesgo.

Si el club crece:

La capacidad del servidor se duplica en cualquier momento sin migrar
nada ni perder información, con un incremento de USD 12 al mes. No
hace falta decidirlo hoy.

Forma de pago:

• Mensual: por adelantado, dentro de los primeros 5 días del mes.
  El proveedor del servidor cobra por anticipado.
• Anual: 11 meses abonados, 12 meses de servicio.

Quedo atento a cualquier consulta.
```

### Decisiones de redacción, para que no se deshagan sin querer

- **Un solo plan.** Dos opciones le dan al club permiso para elegir la barata, y
  obligan a defender por qué la cara vale más. Una sola, bien fundada, convierte
  mejor.
- **El párrafo del respaldo diario le pone precio a la alternativa mala** (menos
  de USD 2) y nombra la consecuencia concreta (pedirle comprobantes a las
  familias). Así la pregunta «¿y si semanal?» no llega a formularse.
- **«Si el club crece» desactiva la objeción de tamaño antes de que aparezca.**
  Duplicar la máquina cuesta USD 12 y no requiere migración: decirlo evita que
  el club sobredimensione hoy por miedo a quedarse corto mañana.
- **El cobro es por adelantado y la razón es verdadera**, no una excusa: el
  proveedor del servidor cobra anticipado. Nadie discute un plazo que no es
  arbitrario.
- **El anual con un mes bonificado no es un descuento, es una protección.**
  Elimina la cobranza mensual y con ella el riesgo de financiar al club con
  plata propia.

---

## 3. La cuenta del proveedor debe ser del club

No es un detalle administrativo, es exposición personal.

Si la cuenta de DigitalOcean y la tarjeta son personales del desarrollador:
los datos de los socios quedan alojados a su nombre, la responsabilidad sobre
ese alojamiento es suya, y el día que termine la relación hay que migrar todo
bajo presión.

**Estructura correcta:** el club abre la cuenta, el club registra el medio de
pago, el desarrollador administra. Si el club no puede o no quiere hacerlo, esa
excepción se documenta por escrito junto con quién responde por los datos.

El crédito de GitHub Student (~USD 200 por un año) **no se usa para producción**
por la misma razón. Su destino correcto es una máquina de staging propia, para
probar despliegues antes de tocar la de producción.

---

## 4. Umbrales — cuándo este precio deja de alcanzar

Los tres tiers gratis que sostienen el precio tienen un techo. Ninguno avisa
antes de tocarlo.

| Servicio | Techo del tier gratis | Qué pasa al cruzarlo | Cómo se detecta |
|---|---|---|---|
| **Resend** | 3.000 correos/mes **y 100 por día** | El envío se corta; la tarea de alertas queda a medias | El tope diario es el que muerde primero: `alertas_tareas.py:47` corre una vez por día y manda un correo por membresía próxima a vencer |
| **Cloudinary** | 25 créditos/mes | El siguiente tier salta a **USD 99/mes**. No hay escalón intermedio | Panel de Cloudinary. Revisar cada tres meses |
| **Droplet 2GB** | ~1.3 GB en uso | El kernel mata el contenedor más pesado (OOM) | `docker stats`. Los `mem_limit` de la sección 5 lo vuelven visible en vez de sorpresivo |

**El de Resend es el que hay que vigilar.** El tope es **diario**, no mensual: un
mes con 120 vencimientos corta la tanda a la mitad y **no lanza error visible**.
El plan pago de Resend (USD 20/mes, sin tope diario) es el primer ajuste de
precio que va a hacer falta, y recién cuando el club supere ~80 vencimientos
mensuales.

**Mitigación sin costo, acordada el 13 de agosto de 2026:** escalonar las
inscripciones por horario para que los vencimientos no caigan todos la misma
fecha. Reparte el pico diario, pero **no toca el tope mensual de 3.000** y
depende de que el club sostenga la práctica: es un hábito operativo, no un
candado del sistema. Aleja el techo, no lo elimina.

### Los tres techos están trasladados por escrito

Hasta el 13 de agosto de 2026 el mensaje al club trasladaba **solo** el del
servidor (+USD 12, párrafo «Si el club crece»). Los otros dos los absorbía el
margen: con Resend pago, el servicio quedaba en **−USD 1.85**.

El club aceptó los tres. Quedan en `acuerdo-de-servicio.md` con monto y
disparador:

| Caso | Ajuste | Disparador |
|---|---|---|
| Capacidad del servidor | +USD 12 / mes | El droplet queda justo (`docker stats`) |
| Plan de correo sin tope diario | +USD 20 / mes | ~80 vencimientos concentrados en una fecha |
| Salto de almacenamiento | USD 99 / mes | Se supera el tier gratis de Cloudinary |

**No bajar el precio sin revisar esta tabla.** El margen no es ganancia: es lo
único que separa «el club creció» de «pago por trabajar». Se evaluó bajar a USD
30 el 13 de agosto de 2026 y se descartó por eso — el recorte sale entero del
margen, porque los proveedores cobran lo mismo.

---

## 5. Prerrequisito técnico de este precio — CERRADO

El precio de USD 35 asume tres cambios sin los cuales la máquina de 2GB no es
viable y el costo real sería el de 4GB (USD 24 de droplet en lugar de USD 12).

**Los tres están hechos.** Verificado el 13 de agosto de 2026 contra `bc32a49`:

1. **`celery-worker` en `--concurrency=1`** — `docker-compose.yml:149`. Libera un
   proceso con la aplicación completa cargada. Costo funcional: la tarea nocturna
   de vencimientos procesa de a una membresía en vez de dos, a las 02:30, sobre
   decenas de filas.
2. **`mem_limit` por servicio** — nueve declaraciones en `docker-compose.prod.yml`.
   Sin ellos, un contenedor que se dispara se lleva puestos a los otros seis.
3. **`mailpit` fuera de producción** — quedó solo en
   `docker-compose.override.yml:56`, y ya no se declara en la base. No se podía
   resolver desde el overlay de producción, porque los overlays de Compose se
   fusionan y nunca remueven.

El ingress TLS (Caddy) y la rotación de logs también cerraron; Caddy figura en el
overlay de producción. **El precio de USD 35 ya no depende de trabajo pendiente.**

> Cómo re-verificarlo, en vez de creerle a este párrafo:
> `rg -n 'concurrency=' docker-compose.yml`, `rg -c 'mem_limit' docker-compose.prod.yml`,
> `rg -n '^  mailpit:' docker-compose.yml docker-compose.override.yml`.

---

## 6. Qué NO incluye este precio

**Acordado por escrito el 13 de agosto de 2026** y asentado en
[`acuerdo-de-servicio.md`](acuerdo-de-servicio.md), cláusula 6. Se conserva acá
para que la omisión siga siendo deliberada y no un olvido:

- Desarrollo de funcionalidad nueva (distinto de corrección de defectos).
- Carga inicial de datos históricos del club.
- Capacitación al personal más allá de una entrega inicial.
- Tiempo de respuesta comprometido ante incidentes fuera de horario.
- Costo del dominio si el club exige un TLD distinto de `.com`.

---

## Fuentes verificadas el 11 de agosto de 2026

- Droplets DigitalOcean — https://www.digitalocean.com/pricing/droplets
- Bases gestionadas DigitalOcean — https://www.digitalocean.com/pricing/managed-databases
- Resend — https://resend.com/pricing
- Cloudinary — https://cloudinary.com/pricing
- Ajuste de precios de Hetzner del 15/06/2026 — https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
