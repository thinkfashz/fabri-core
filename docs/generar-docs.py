#!/usr/bin/env python3
"""
Genera la documentación de FABRI-CORE a partir del contrato funcional
(spec/fabri_core_android_screen_spec.json): pantallas, esquema de datos y
tests de aceptación en Markdown. Así la documentación nunca se desincroniza
del spec: si el JSON cambia, se regenera.

Uso:  python3 docs/generar-docs.py
"""
import json
import pathlib
import re
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec" / "fabri_core_android_screen_spec.json"
OUT = ROOT / "docs"
OUT.mkdir(exist_ok=True)

p = json.loads(SPEC.read_text(encoding="utf-8"))
proj = p["project"]


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def b(x) -> str:
    return str(x).replace("|", "\\|")


# ─────────────────────────── SCREENS.md ───────────────────────────
L = []
L.append(f"# FABRI-CORE · Contrato de pantallas ({proj['name']} v{proj['version']})")
L.append("")
L.append(f"> Generado desde `spec/{SPEC.name}` el "
         f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC. "
         "No editar a mano: se regenera con `python3 docs/generar-docs.py`.")
L.append("")
L.append(f"- **Plataforma**: {proj['platform']}")
L.append(f"- **Idioma / zona**: {proj['language']} · {proj['timezone']}")
L.append(f"- **Propósito**: {proj['purpose']}")
L.append("")

L.append("## Índice de navegación")
L.append("")
L.append("| # | Pantalla | Ruta | Estados |")
L.append("|---|----------|------|---------|")
for i, s in enumerate(proj["screens"], 1):
    st = ", ".join(s.get("states", []))
    L.append(f"| {i} | {b(s['title'])} | `{s['route']}` | {b(st)} |")
L.append("")

for s in proj["screens"]:
    L.append(f"## {s['title']}")
    L.append("")
    L.append(f"- **id**: `{s['id']}`  ·  **ruta**: `{s['route']}`")
    L.append(f"- **Propósito**: {s.get('purpose','')}")
    L.append("")
    L.append("### Layout")
    for it in s.get("layout", []):
        L.append(f"- {it}")
    L.append("")
    L.append("### Fuentes de datos")
    for it in s.get("data_sources", []):
        L.append(f"- `{it}`")
    L.append("")
    L.append("### Acciones")
    for it in s.get("actions", []):
        L.append(f"- {it}")
    L.append("")
    L.append("### Lógica")
    for it in s.get("logic", []):
        L.append(f"- {it}")
    L.append("")
    L.append("### Estados")
    L.append("")
    L.append("| Estado | Qué muestra la UI |")
    L.append("|---|---|")
    estado_desc = {
        "loading": "Esqueleto/spinner; sin datos inventados.",
        "ready": "Datos reales, acciones habilitadas.",
        "partial": "Parte de las fuentes respondió: se marca qué falta y se ofrece reintento.",
        "error": "Mensaje con causa real y acción de reintento; nunca un error genérico.",
        "offline": "Sin conexión con el backend: estado explícito, no valores obsoletos.",
        "empty": "Estado vacío real con acción para crear.",
    }
    for st in s.get("states", []):
        L.append(f"| `{st}` | {estado_desc.get(st, 'Estado definido en el spec.')} |")
    L.append("")

(OUT / "SCREENS.md").write_text("\n".join(L) + "\n", encoding="utf-8")

# ───────────────────── ARCHITECTURE.md (esquema) ─────────────────────
A = []
A.append(f"# FABRI-CORE · Arquitectura y datos (v{proj['version']})")
A.append("")
A.append("> Sección de esquema generada desde el spec. El resto del documento "
         "(decisiones, IPC, grafo en vivo) está en `ARCHITECTURE.md`.")
A.append("")
A.append("## Modelo de datos")
A.append("")
A.append("| Tabla | Propósito |")
A.append("|---|---|")
for t in proj["data_model"]["tables"]:
    A.append(f"| `{t['name']}` | {b(t.get('purpose',''))} |")
A.append("")
if proj["data_model"].get("notes"):
    A.append("### Notas")
    for n in proj["data_model"]["notes"]:
        A.append(f"- {n}")
    A.append("")
if proj["data_model"].get("principles"):
    A.append("### Principios")
    for n in proj["data_model"]["principles"]:
        A.append(f"- {n}")
    A.append("")

(OUT / "SCHEMA.md").write_text("\n".join(A) + "\n", encoding="utf-8")

# ───────────────────── ACCEPTANCE.md ─────────────────────
T = ["# FABRI-CORE · Criterios de aceptación", "",
     "> Generado desde el spec. Cada criterio es binario: pasa o no pasa.", ""]
for i, t in enumerate(proj["acceptance_tests"], 1):
    T.append(f"{i}. {t}")
T.append("")
T.append("## Política de exportación")
T.append("")
ep = proj.get("export_policy", {})
if ep.get("formats"):
    T.append("| Formato | Uso |")
    T.append("|---|---|")
    for k, v in ep["formats"].items():
        T.append(f"| {k} | {b(v)} |")
    T.append("")
for r in ep.get("requirements", []):
    T.append(f"- {r}")
T.append("")
(OUT / "ACCEPTANCE.md").write_text("\n".join(T) + "\n", encoding="utf-8")

print("docs generadas:", ", ".join(sorted(f.name for f in OUT.glob("*.md"))))
print("pantallas:", len(proj["screens"]), "| tablas:", len(proj["data_model"]["tables"]),
      "| tests:", len(proj["acceptance_tests"]))
