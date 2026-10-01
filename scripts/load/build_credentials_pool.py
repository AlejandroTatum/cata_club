#!/usr/bin/env python3
"""Construye el pool local de credenciales para las corridas de carga k6
(pool 1:1 de identidades ALUMNO auto-gestionadas del seed masivo de QA).

  Uso: QA_SEED_PASSWORD='...' scripts/load/build_credentials_pool.py \
         [--tamanio 100] [--salida load/results/credentials-pool.json]

Reglas de secreto (no negociables):
  - El password entra SOLO por QA_SEED_PASSWORD y se escribe ÚNICAMENTE en
    el archivo de salida (local, git-ignorado, permisos 0600). No se imprime
    en stdout/stderr, no se guarda en el repo, no viaja por la red.
  - La salida estándar solo informa conteos y la ruta del archivo.

Elegibilidad (espejo exacto del test
`backend/tests/test_seed_dev_bulk.py::test_el_pool_de_carga_tiene_al_menos_
cien_identidades_unicas`): rol ALUMNO puro, auto-gestionado (sin
representante), usuario activo con correo verificado, persona activa.

Fail-closed: sin QA_SEED_PASSWORD, sin contenedor de QA, o con menos
identidades que las pedidas → exit != 0 con mensaje, nunca un pool chico.
"""

import argparse
import json
import os
import subprocess
import sys

PROYECTO_QA = os.environ.get("LOAD_POOL_PROJECT", "cataclub-qa")
SERVICIO_DB = os.environ.get("LOAD_POOL_SERVICE", "db")
RUTA_DEFAULT = "load/results/credentials-pool.json"

SQL_POOL = """
SELECT DISTINCT u.correo
FROM usuario u
JOIN usuario_rol ur ON ur.usuario_id = u.id
JOIN rol r ON r.id = ur.rol_id
JOIN persona p ON p.id = u.persona_id
WHERE r.tipo_rol = 'ALUMNO'
  AND u.correo IS NOT NULL
  AND u.activo
  AND u.correo_verificado
  AND p.activo
  AND p.representante_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM usuario_rol ur2
    JOIN rol r2 ON r2.id = ur2.rol_id
    WHERE ur2.usuario_id = u.id AND r2.tipo_rol != 'ALUMNO'
  )
ORDER BY u.correo
LIMIT %(limite)s
"""


def morir(mensaje):
    print(f"Error: {mensaje}", file=sys.stderr)
    sys.exit(1)


def contenedor_db():
    resultado = subprocess.run(
        [
            "docker", "ps", "-q",
            "--filter", f"label=com.docker.compose.project={PROYECTO_QA}",
            "--filter", f"label=com.docker.compose.service={SERVICIO_DB}",
        ],
        capture_output=True, text=True,
    )
    ids = resultado.stdout.split()
    return ids[0] if ids else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tamanio", type=int, default=100,
                        help="identidades pedidas (default 100)")
    parser.add_argument("--salida", default=RUTA_DEFAULT,
                        help=f"archivo de salida git-ignorado (default {RUTA_DEFAULT})")
    args = parser.parse_args()

    contrasenia_seed = os.environ.get("QA_SEED_PASSWORD", "")
    if not contrasenia_seed:
        morir("exporta QA_SEED_PASSWORD con el password del seed de QA "
              "(nunca se imprime ni se versiona)")

    cid = contenedor_db()
    if not cid:
        morir(f"no encontré el contenedor de BD del stack QA "
              f"(labels proyecto={PROYECTO_QA} servicio={SERVICIO_DB}); "
              "levantalo con 'make qa-up'")

    def env_contenedor(nombre):
        obtenido = subprocess.run(
            ["docker", "exec", cid, "printenv", nombre],
            capture_output=True, text=True,
        )
        return obtenido.stdout.strip() if obtenido.returncode == 0 else ""

    usuario_db = env_contenedor("POSTGRES_USER") or "usuario"
    nombre_db = env_contenedor("POSTGRES_DB") or "cataclub_db"

    consulta = subprocess.run(
        ["docker", "exec", cid, "psql", "-U", usuario_db, "-d", nombre_db,
         "-tAc", SQL_POOL % {"limite": args.tamanio}],
        capture_output=True, text=True,
    )
    if consulta.returncode != 0:
        morir(f"la consulta de identidades falló: {consulta.stderr.strip()[:200]}")

    correos = sorted({linea.strip() for linea in consulta.stdout.splitlines() if linea.strip()})
    if len(correos) < args.tamanio:
        morir(f"el seed de QA solo ofrece {len(correos)} identidades elegibles, "
              f"menos de las {args.tamanio} pedidas; revisá que 'make qa-up' "
              "haya corrido el seed masivo actualizado")

    pool = [{"email": correo, "password": contrasenia_seed} for correo in correos]
    directorio = os.path.dirname(args.salida)
    if directorio:
        os.makedirs(directorio, exist_ok=True)
    descriptor = os.open(args.salida, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as archivo:
        json.dump(pool, archivo, indent=1)
    os.chmod(args.salida, 0o600)

    # Solo conteos y ruta: jamás el contenido del pool.
    print(f"Pool de credenciales: {len(pool)} identidades → {args.salida}")
    print(f"Úsalo con: LOAD_CREDENTIALS_FILE={args.salida} make load-steady")


if __name__ == "__main__":
    main()
