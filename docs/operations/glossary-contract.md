# Contrato del glosario canónico

> **Estado:** Activa · **Responsable:** desarrollo backend/frontend (asignación
> nominal pendiente) · **Audiencia:** desarrollo y QA
> **Creado:** issue [#903](https://github.com/AlejandroTatum/cata_club/issues/903) ·
> **Relacionado:** [#865](https://github.com/AlejandroTatum/cata_club/issues/865),
> cadena #898 → #905

## Autoridad

La autoridad del glosario de producto vive en `cata_club-docs`, archivo
`reference/glosario.json`. Este repositorio **no** define terminología: consume
un snapshot generado y fijado. El snapshot de esta revisión proviene de:

- **Commit de docs:** `4ac3ad73ecca6a2a0490dfe9832a76453e1054ef`
- **sha256 del archivo publicado:** `3ff537e11714f8295dfc5ab935699ca049db3229fd399b8aa1983f1402b312de`
- **sha256 de las entradas (forma canónica):** `4eab60995913d51a6c7b88ef823cb7f940ba69bfede8b10f4e49ee8efde55d8a`

## El snapshot en la aplicación

- Vive dentro de `backend/app/servicios_negocio/conocimiento_club.json`, bajo
  la clave `glosario`, y se espeja **byte a byte** en
  `frontend/src/data/club-knowledge.json` (mismo mecanismo que el resto del
  conocimiento; cada contexto de build de Docker ve su copia).
- Está marcado `generado: true` y `no_editar_a_mano: true`. No se edita a mano:
  se regenera (ver abajo).
- `entradas_sha256` es el sha256 de la serialización canónica de `entradas`
  (`json.dumps(..., sort_keys=True, ensure_ascii=False, separators=(",", ":"))`).
  Es recomputable **offline**, de ambos lados: Python (`hashlib`) en
  `tests/test_glossary_contract.py` y Node (`node:crypto`) en
  `frontend/src/lib/__tests__/chatbot-contract.test.ts`.
- `sha256_fuente_publicada` es el hash de los **bytes publicados** en docs. Es
  el ancla al repo de autoridad: se verifica con `git show` al regenerar, no en
  cada corrida de CI.

## El gate compartido (offline)

`tests/test_glossary_contract.py` (raíz, corre con el venv del backend) es el
gate único:

1. **Procedencia:** commit y hashes bienformados, marcadores de generado, ids
   únicos, y el hash del contenido recomputa. Una edición manual de cualquier
   entrada lo pone rojo.
2. **No vacío:** falla si el glosario o el conjunto de entradas comprobadas
   está vacío, y ejercita divergencias sintéticas (backend y frontend) como
   regresión permanente.
3. **Usos representativos:** el prompt del backend (`prompt_sistema.txt`), la
   copy de ayuda y los atajos del chat del frontend usan los términos canónicos
   (o formas de contexto declaradas por el propio glosario), y las variantes
   prohibidas (`inscripto`, `inscriptos`, `sesións`) no aparecen en ninguna
   superficie comprobada (el barrido lee la copy embarcada sin el propio
   bloque `glosario`, cuyos metadatos declaran esas variantes).

Nada de esto toca la red: todos los archivos viven en el repositorio. La CI
normal valida el snapshot sin acceso a `cata_club-docs`.

## Regenerar el snapshot

1. En `cata_club-docs`, publicar la nueva revisión de `reference/glosario.json`.
2. Leer los bytes publicados (`git show <commit>:reference/glosario.json`),
   calcular su sha256 y el de las entradas en forma canónica.
3. Reemplazar el bloque `glosario` en `conocimiento_club.json` con
   `generado/no_editar_a_mano/autoridad/archivo_fuente/commit_fuente/
   sha256_fuente_publicada/schema_version/estado_fuente/idioma/entradas_sha256/
   entradas` actualizados, y copiar el archivo byte a byte al espejo del
   frontend.
4. Correr `make test-root`, `make test-backend`, `make test-frontend` y
   `pnpm type-check`.

## Divergencias inventariadas (sin corregir — Issues hijos)

El issue #903 no corrige copy. Divergencias observadas contra el glosario,
asignables a issues hijos:

| # | Entrada | Divergencia observada | Superficie | Destino |
|---|---------|----------------------|------------|---------|
| 1 | `jugador` | El término visible canónico «Jugador» no aparece; la copy usa las formas de contexto «alumno»/«estudiante» | prompt + ayuda | issue hijo (copy BE+FE) |
| 2 | `miembro` | La copy visible dice «socio» («un socio mayor de edad…»), forma que el glosario no registra | prompt + ayuda | issue hijo (copy BE+FE) |
| 3 | `cuota` / `tipo_membresia` | La pregunta «¿Cuánto cuesta la mensualidad?» usa «mensualidad», término ausente del glosario | ayuda + prompt | issue hijo (copy BE+FE) |
| 4 | `comprobante_pago` | «voucher» es variante deprecada y se conserva como identificador técnico (política del glosario); pendiente barrer superficies visibles fuera de este gate | api/identificadores | issue hijo (FE) |
| 5 | estados de membresía/pago | Publicados por separado según el glosario; las superficies de badges (`status-badges.ts`, `membership-status.ts`) no están cubiertas por este gate | FE | issue hijo (FE) |
