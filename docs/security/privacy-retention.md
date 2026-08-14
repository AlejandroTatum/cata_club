# Privacidad y retención de datos

Clasificación de los datos que maneja el sistema, qué retención mínima se
**propone** (política, no implementada) y qué protección está **ya
implementada** (verificable en el repo). Este documento no afirma
cumplimiento de ninguna ley: la validación legal/jurídica es una decisión
pendiente y está señalizada como tal.

> **Estado:** Activa (política propuesta; protección implementada verificada)
>
> **Responsable:** Privacidad / datos (asignación nominal pendiente — ver
> [`../reference/ownership.md`](../reference/ownership.md))
>
> **Audiencia:** producto, desarrollo y operación
>
> **Última verificación:** 2026-08-13 · **Verificado contra commit:** `fd9f7be`
>
> **Revisión recomendada:** con cada categoría de dato nueva y antes de definir retención final

## Clasificación de datos

| Categoría | Datos | Dónde viven (modelo) | Sensibilidad |
|---|---|---|---|
| Menores | Personas < 18 años, representantes, inscripciones | `Persona`, `Enrollment` | Alta: ficha médica + representación legal |
| Salud | Ficha médica: tipo de sangre, alergias, condiciones, contacto y teléfono de emergencia | `FichaMedica` | Alta: dato de salud |
| Pagos | Montos, métodos, comprobantes PDF, vouchers, estados de validación | `Pago`, `ComprobantePago`, `Membresia` | Alta: dato financiero |
| Documentos | Comprobantes PDF oficiales y vouchers subidos por el cliente | Cloudinary (`cataclub/comprobantes`, `cataclub/vouchers`) | Alta |
| Fotos | Fotos de perfil self-service | Cloudinary (`cataclub/fotos_perfil`) | Media |
| Identidad | Cédula, correo, teléfono, nombres | `Persona`, `Usuario` | Alta (identificación) |
| Evidencia QA | Capturas e informes de auditorías | `docs/archive/audits/`, `docs/archive/fixes/img/` | Media: contienen datos **sembrados** (entorno QA), no datos reales de socios |

## Política propuesta (NO implementada — requiere decisión)

Retención mínima sugerida como punto de partida. **Nada de esto está
configurado en el sistema todavía**; requiere decisión de producto, y la
conformidad legal debe validarse con asesoramiento (pendiente).

| Categoría | Retención mínima propuesta | Acción al vencer | Decisión pendiente |
|---|---|---|---|
| Fichas médicas (salud) | Vigencia de la membresía + período prudencial | Revisión caso a caso (documento médico) | Quién autoriza el borrado |
| Datos de menores | Mientras dure la relación + período legal | Borrado/supresión al cese | Mecanismo de supresión |
| Pagos y comprobantes | Plazo fiscal/legal aplicable (validar) | Archivo o borrado según requisito | Definir con asesor legal |
| Fotos de perfil | Mientras la cuenta esté activa | Borrado al desactivar | |
| Evidencia QA | Indefinida (histórica, inmutable) | No aplica: se conserva como evidencia de proyecto | |

## Protección ya implementada (verificada contra `fd9f7be`)

| Protección | Detalle | Evidencia |
|---|---|---|
| Tokens solo en cookies `HttpOnly` | El BFF devuelve exactamente `{enrolled: true}`; ningún token llega al JS del navegador | Contrato del BFF documentado en `docs/archive/audits/2026-08-12/README.md`; `frontend/src/lib/auth-cookies.ts` |
| `/docs` apagado en producción | `docs_url/redoc_url/openapi_url` nulos con `AMBIENTE=production` | `backend/app/soporte_transversal/configuracion.py` |
| Headers de seguridad | HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy en Caddy; CSP `default-src 'none'` en la API | `Caddyfile`, `backend/main.py` |
| Errores sin filtrar internos | Traducción de 500/422/429 a mensajes legibles sin detalles internos (tracebacks, jerga de slowapi) | Informe de inscripción (S04, S05, X04) |
| URLs firmadas para comprobantes/vouchers nuevos | Subida como `authenticated`; URL firmada al leerla; vencimiento opcional con `CLOUDINARY_AUTH_TOKEN_KEY` | `docs/archive/fixes/16-voucher-no-enumerable.md`; ítem A-7 abierto para filas legacy |
| Identidad duplicada sin oráculo | El 400 de identidad ya registrada devuelve el mismo texto para cédula/correo | Informe de inscripción (S03) |
| Rate limiting | Límites por endpoint; hallazgo abierto: cubo global del tráfico anónimo | `backend/app/soporte_transversal/rate_limit.py`; lista viva |

## Brechas conocidas

- **Retención/borrado**: no hay mecanismo de purga ni ciclo de vida de datos
  personales implementado; política pendiente (arriba).
- **Supresión de menores**: no hay flujo de «derecho al olvido» ni decisión
  de borrado lógico vs. duro para `Persona` (decisión de negocio abierta).
- **Validación legal**: nadie validó conformidad normativa; no afirmar
  cumplimiento hasta que ocurra.
- **CSP del sitio**: falta a propósito (ver `Caddyfile`) hasta poder
  verificarla contra Next.js real.

## Referencias

- Lista viva y hallazgos: [`../operations/production-readiness.md`](../operations/production-readiness.md)
- Decisiones de negocio pendientes (borrado de Persona): histórico
  [`../archive/plans/pendientes-2026-08-11.md`](../archive/plans/pendientes-2026-08-11.md)
- Evidencia de comprobantes: [`../archive/fixes/16-voucher-no-enumerable.md`](../archive/fixes/16-voucher-no-enumerable.md)
