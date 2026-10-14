#!/usr/bin/env bash
# Regla única de versión de release: MAJOR.MINOR.PATCH, solo dígitos y sin `v`.
# Este archivo se `source`ea, nunca se ejecuta: lo importan `deploy.sh`,
# `record-release.sh` y `rollback-release.sh`, que antes repetían el regex.
# Cada script conserva su propio mensaje de error; solo la regla es compartida.

# `is_semver <valor>`: sale 0 si el valor es MAJOR.MINOR.PATCH, 1 si no. El ancla
# `$` no admite un salto de línea final ni valores multilínea.
is_semver() {
  [[ "${1-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}
