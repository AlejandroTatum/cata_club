#!/usr/bin/env python3
"""Server-side figures for a load run, from two Prometheus text scrapes.

The runner scrapes the backend `/metrics` (from inside the Compose network)
before and after k6; this script turns the two snapshots into per-route
deltas so they can sit next to the k6 client-side numbers:

  - requests and 5xx per route (`http_requests_total`, handler = route template)
  - server-side p95 per route from the `http_request_duration_seconds` bucket
    deltas (whatever `le` boundaries the backend exposes; precision depends on
    them, so the honest figure is the upper bound `p95_le_seconds` and
    `p95_estimate_seconds` interpolates linearly inside that bucket)
  - outbox pending / oldest-pending age, taken from the AFTER scrape

Usage: server_metrics.py BEFORE.prom AFTER.prom [--json OUT.json]
Prints a text report; `--json` also writes the machine-readable report.
Standard library only, no network: it parses files.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict

_LINEA = re.compile(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)")
_ETIQUETA = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')

REQUESTS = "http_requests_total"
BUCKET = "http_request_duration_seconds_bucket"


def parse_prometheus_text(texto: str) -> dict:
    """Map `(name, sorted label tuple)` to its float value; comments skipped."""
    series = {}
    for linea in texto.splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        m = _LINEA.match(linea)
        if not m:
            continue
        nombre, crudas, valor = m.groups()
        etiquetas = tuple(sorted(_ETIQUETA.findall(crudas or "")))
        try:
            series[(nombre, etiquetas)] = float(valor)
        except ValueError:
            continue
    return series


def _delta(antes: dict, despues: dict, clave, estado: dict) -> float:
    """Counter delta; a lower AFTER value means the process restarted."""
    previo = antes.get(clave, 0.0)
    actual = despues[clave]
    if actual < previo:
        estado["reset"] = True
        return actual
    return actual - previo


def _ruta(etiquetas: dict) -> str:
    return f"{etiquetas.get('method', '?')} {etiquetas.get('handler', '?')}"


def _p95(buckets: list[tuple[float, float]]) -> dict:
    """p95 from cumulative `(le, delta count)` pairs sorted by `le`."""
    total = buckets[-1][1] if buckets else 0.0
    if total <= 0:
        return {"p95_le_seconds": None, "p95_estimate_seconds": None, "p95_over_seconds": None}
    rango = 0.95 * total
    previo_le, previo_n = 0.0, 0.0
    for le, n in buckets:
        if n >= rango:
            if math.isinf(le):
                return {
                    "p95_le_seconds": None,
                    "p95_estimate_seconds": None,
                    "p95_over_seconds": previo_le,
                }
            ancho = n - previo_n
            fraccion = (rango - previo_n) / ancho if ancho > 0 else 1.0
            return {
                "p95_le_seconds": le,
                "p95_estimate_seconds": previo_le + (le - previo_le) * fraccion,
                "p95_over_seconds": None,
            }
        previo_le, previo_n = le, n
    return {"p95_le_seconds": None, "p95_estimate_seconds": None, "p95_over_seconds": previo_le}


def build_report(antes_texto: str, despues_texto: str) -> dict:
    antes = parse_prometheus_text(antes_texto)
    despues = parse_prometheus_text(despues_texto)
    estado = {"reset": False}
    rutas: dict[str, dict] = defaultdict(lambda: {"requests": 0, "errors_5xx": 0})
    buckets: dict[str, list] = defaultdict(list)

    for clave in despues:
        nombre, etiquetas = clave
        et = dict(etiquetas)
        if nombre == REQUESTS:
            d = _delta(antes, despues, clave, estado)
            ruta = rutas[_ruta(et)]
            ruta["requests"] += int(round(d))
            if et.get("status", "").startswith("5"):
                ruta["errors_5xx"] += int(round(d))
        elif nombre == BUCKET:
            le = float("inf") if et.get("le") == "+Inf" else float(et["le"])
            buckets[_ruta(et)].append((le, _delta(antes, despues, clave, estado)))

    for ruta, pares in buckets.items():
        rutas[ruta].update(_p95(sorted(pares)))
    for datos in rutas.values():
        datos.setdefault("p95_le_seconds", None)
        datos.setdefault("p95_estimate_seconds", None)
        datos.setdefault("p95_over_seconds", None)

    pendientes = {
        dict(e)["tabla"]: v for (n, e), v in despues.items() if n == "cata_outbox_pendientes"
    }
    antiguedad = {
        dict(e)["tabla"]: v
        for (n, e), v in despues.items()
        if n == "cata_outbox_pendiente_mas_antiguo_segundos"
    }
    scrape_ok = despues.get(("cata_outbox_scrape_ok", ()))
    return {
        "routes": dict(sorted(rutas.items())),
        "totals": {
            "requests": sum(r["requests"] for r in rutas.values()),
            "errors_5xx": sum(r["errors_5xx"] for r in rutas.values()),
        },
        "outbox_end": {
            "pending_total": int(sum(pendientes.values())),
            "oldest_pending_seconds_max": max(antiguedad.values(), default=0.0),
            "by_table": {
                t: {"pending": int(pendientes.get(t, 0)), "oldest_pending_seconds": antiguedad.get(t, 0.0)}
                for t in sorted(set(pendientes) | set(antiguedad))
            },
            "scrape_ok": None if scrape_ok is None else bool(scrape_ok),
        },
        "counter_reset_detected": estado["reset"],
    }


def render_text(informe: dict) -> str:
    lineas = ["Server-side (backend /metrics, delta before -> after)"]
    if informe["counter_reset_detected"]:
        lineas.append("WARNING: counter reset detected (backend restarted); deltas use the final value.")
    lineas.append(f"{'route':<52} {'req':>7} {'5xx':>5} {'p95 <=':>8} {'p95 est':>8}")
    for ruta, d in informe["routes"].items():
        if d["p95_le_seconds"] is not None:
            tope = f"{d['p95_le_seconds']:.2f}s"
            est = f"{d['p95_estimate_seconds']:.3f}s"
        elif d["p95_over_seconds"] is not None:
            tope, est = f">{d['p95_over_seconds']:.2f}s", "-"
        else:
            tope, est = "-", "-"
        lineas.append(f"{ruta:<52} {d['requests']:>7} {d['errors_5xx']:>5} {tope:>8} {est:>8}")
    t = informe["totals"]
    lineas.append(f"{'TOTAL':<52} {t['requests']:>7} {t['errors_5xx']:>5}")
    o = informe["outbox_end"]
    lineas.append(
        f"Outbox at end: pending={o['pending_total']} "
        f"oldest={o['oldest_pending_seconds_max']:.1f}s scrape_ok={o['scrape_ok']}"
    )
    return "\n".join(lineas)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--json", dest="salida_json")
    args = ap.parse_args(argv)
    with open(args.before, encoding="utf-8") as f:
        antes = f.read()
    with open(args.after, encoding="utf-8") as f:
        despues = f.read()
    informe = build_report(antes, despues)
    if args.salida_json:
        with open(args.salida_json, "w", encoding="utf-8") as f:
            json.dump(informe, f, indent=2)
    print(render_text(informe))
    return 0


if __name__ == "__main__":
    sys.exit(main())
