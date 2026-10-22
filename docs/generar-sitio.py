#!/usr/bin/env python3
"""
Genera el sitio documental de FABRI-CORE (un solo HTML, autocontenido):
- 4 temas intercambiables (los de la app)
- el diagrama de arquitectura embebido (base64)
- las 17 pantallas, el esquema de datos y los errores→mejoras
- la receta de build en el teléfono

Uso: python3 docs/generar-sitio.py
"""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
spec = json.loads((ROOT / "spec" / "fabri_core_android_screen_spec.json").read_text())["project"]

png = ROOT / "diagrams" / "fabri-core-arquitectura.png"
b64 = base64.b64encode(png.read_bytes()).decode() if png.exists() else ""

THEMES = [("lime", "#C8FF00", "Verde limón"), ("purple", "#A855F7", "Morado"),
          ("blue", "#3B82F6", "Azul"), ("gold", "#EAB308", "Amarillo oro")]


def md_to_html(path: pathlib.Path, limit=None) -> str:
    if not path.exists():
        return ""
    txt = path.read_text(encoding="utf-8")
    if limit:
        txt = txt[:limit]
    out = []
    in_code = False
    in_table = False
    for line in txt.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            out.append("</code></pre>" if in_code else "<pre><code>")
            continue
        if in_code:
            out.append(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue
            if not in_table:
                out.append("<table><thead><tr>" + "".join(f"<th>{c}</th>" for c in cells) + "</tr></thead><tbody>")
                in_table = True
            else:
                out.append("<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</tbody></table>")
            in_table = False
        if line.startswith("### "):
            out.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{line[2:]}</h1>")
        elif line.startswith("> "):
            out.append(f"<blockquote>{line[2:]}</blockquote>")
        elif re.match(r"^\s*[-*] ", line):
            out.append(f"<li>{re.sub(r'^\s*[-*] ', '', line)}</li>")
        elif line.strip() == "":
            out.append("")
        else:
            out.append(f"<p>{line}</p>")
    if in_table:
        out.append("</tbody></table>")
    if in_code:
        out.append("</code></pre>")
    # lista continua
    html = "\n".join(out)
    html = re.sub(r"((?:<li>.*?</li>\n?)+)", lambda m: "<ul>\n" + m.group(1) + "</ul>", html, flags=re.S)
    return html


screen_rows = "\n".join(
    f"<tr><td><code>{s['route']}</code></td><td>{s['title']}</td>"
    f"<td>{s.get('purpose','')}</td>"
    f"<td>{', '.join(s.get('states', []))}</td></tr>"
    for s in spec["screens"]
)

table_rows = "\n".join(
    f"<tr><td><code>{t['name']}</code></td><td>{t.get('purpose','')}</td></tr>"
    for t in spec["data_model"]["tables"]
)

tests = "\n".join(f"<li>{t}</li>" for t in spec["acceptance_tests"])

HTML = f"""<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FABRI-CORE · Documentación</title>
<style>
  :root {{
    --bg:#050505; --surface:#101010; --card:#171717; --border:#282828;
    --text:#F5F5F5; --muted:#858585; --accent:#C8FF00; --accent-soft:rgba(200,255,0,.14);
  }}
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{background:var(--bg);color:var(--text);font-family:'DejaVu Sans',ui-sans-serif,system-ui,sans-serif;line-height:1.6}}
  .wrap{{max-width:1080px;margin:0 auto;padding:0 20px 90px}}
  header{{position:sticky;top:0;z-index:20;background:rgba(5,5,5,.92);backdrop-filter:blur(10px);
    border-bottom:1px solid var(--border);padding:14px 0;display:flex;gap:16px;align-items:center;flex-wrap:wrap}}
  header img{{width:132px}}
  h1{{font-size:clamp(28px,5vw,46px);letter-spacing:-.03em;margin:26px 0 8px}}
  h2{{font-size:clamp(20px,3vw,28px);margin:44px 0 6px;letter-spacing:-.02em}}
  h3{{font-size:17px;margin:22px 0 4px;color:var(--accent)}}
  p,li{{color:#C9D1D9;font-size:15px}}
  .lead{{color:var(--muted);font-size:17px;max-width:70ch}}
  .kicker{{color:var(--accent);font-size:12px;letter-spacing:.28em;text-transform:uppercase;font-weight:700}}
  .themes{{display:flex;gap:8px;margin-left:auto}}
  .themes button{{width:30px;height:30px;border-radius:9px;border:1px solid var(--border);cursor:pointer;background:#000}}
  .chips{{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}}
  .chip{{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text)}}
  .chip.on{{border-color:var(--accent);color:var(--accent)}}
  .card{{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px 18px;margin:10px 0}}
  table{{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}}
  th,td{{text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}}
  th{{color:var(--accent);font-size:11px;letter-spacing:.14em;text-transform:uppercase}}
  code{{font-family:'DejaVu Sans Mono',monospace;background:rgba(200,255,0,.10);border:1px solid rgba(200,255,0,.2);
    color:#e9f7b0;border-radius:5px;padding:1px 5px;font-size:.92em}}
  pre{{background:#0a0b0d;border:1px solid var(--border);border-radius:12px;padding:14px;overflow:auto;font-size:12.5px}}
  pre code{{background:none;border:none;color:#B9C4D0;padding:0}}
  blockquote{{border-left:3px solid var(--accent);padding:8px 14px;margin:12px 0;background:var(--surface);border-radius:0 10px 10px 0;color:var(--muted)}}
  ul{{padding-left:20px}} li{{margin:3px 0}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:14px 0}}
  .metric{{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px}}
  .metric b{{display:block;font-size:24px;color:var(--accent)}}
  .metric span{{font-size:12px;color:var(--muted)}}
  figure{{margin:18px 0}} figure img{{width:100%;border:1px solid var(--border);border-radius:14px;background:#000}}
  figcaption{{font-size:12px;color:var(--muted);margin-top:8px}}
  footer{{margin-top:60px;padding-top:18px;border-top:1px solid var(--border);color:var(--muted);font-size:13px}}
  .toast{{position:fixed;bottom:18px;right:18px;background:var(--card);border:1px solid var(--accent);color:var(--text);
    padding:10px 14px;border-radius:12px;font-size:13px;opacity:0;transition:.3s;pointer-events:none}}
  .toast.on{{opacity:1}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <img src="data:image/svg+xml;base64,{base64.b64encode(pathlib.Path('/root/video-engine/assets/logo-fabrick.svg').read_bytes()).decode()}" alt="Soluciones Fabrick" />
  <span class="kicker">FABRI-CORE · documentación</span>
  <div class="themes" id="themes">
    {"".join(f'<button data-c="{c}" title="{n}" style="background:{c}"></button>' for c, n, _ in THEMES)}
  </div>
</header>

<div class="kicker">Producto · Android autónomo</div>
<h1>FABRI-CORE Autonomous Sandbox</h1>
<p class="lead">Aplicación Android con sandbox privado, terminal, entorno Linux opcional, agente IA,
memoria híbrida (SQLite + FTS5 + embeddings), catálogos, facturación, exportaciones y visualización
de flujos en vivo. <b>Todo esto se compila y se ejecuta en el propio teléfono.</b></p>

<div class="chips">
  <span class="chip on">v{spec['version']}</span>
  <span class="chip">{spec['platform']}</span>
  <span class="chip">{spec['language']} · {spec['timezone']}</span>
  <span class="chip">Kotlin + Go</span>
  <span class="chip">SQLite / FTS5</span>
  <span class="chip">4 temas</span>
</div>

<div class="grid">
  <div class="metric"><b>{len(spec['screens'])}</b><span>pantallas con contrato</span></div>
  <div class="metric"><b>{len(spec['data_model']['tables'])}</b><span>tablas en el esquema</span></div>
  <div class="metric"><b>{len(spec['acceptance_tests'])}</b><span>criterios de aceptación</span></div>
  <div class="metric"><b>4</b><span>temas (lime · purple · blue · gold)</span></div>
</div>

<h2>El diagrama: Cerebro IA y flujos en vivo</h2>
<figure>
  <img alt="Arquitectura FABRI-CORE" src="data:image/png;base64,{b64}" />
  <figcaption>Cadena real: Android UI → Backend Go → SQLite → FTS5/Embeddings → RAG → Agente IA → Resultados → Memoria.
  El grafo de la app muestra <b>eventos reales</b>: sin backend, la pantalla queda en «desconectado».</figcaption>
</figure>

<h2>Las {len(spec['screens'])} pantallas</h2>
<table><thead><tr><th>Ruta</th><th>Pantalla</th><th>Propósito</th><th>Estados</th></tr></thead><tbody>
{screen_rows}
</tbody></table>

<h2>Modelo de datos</h2>
<table><thead><tr><th>Tabla</th><th>Propósito</th></tr></thead><tbody>
{table_rows}
</tbody></table>

<h2>Documento de ejecución</h2>
{md_to_html(DOCS / 'EXECUTION.md')}

<h2>Arquitectura</h2>
{md_to_html(DOCS / 'ARCHITECTURE.md')}

<h2>Prompt maestro (canónico)</h2>
{md_to_html(DOCS / 'MASTER-PROMPT.md')}

<h2>Errores encontrados y mejoras aplicadas</h2>
{md_to_html(DOCS / 'ERRORES-Y-MEJORAS.md')}

<h2>Criterios de aceptación</h2>
<ul>{tests}</ul>

<footer>
  Generado desde <code>spec/fabri_core_android_screen_spec.json</code> ·
  <span id="stamp"></span> ·
  Soluciones Fabrick · @F.eduardomsz
</footer>
</div>
<div class="toast" id="toast">Tema aplicado</div>
<script>
const THEMES = {json.dumps([{c: c, n: n} for c, n, _ in THEMES])};
const root = document.documentElement;
function setTheme(c) {{
  root.style.setProperty('--accent', c);
  root.style.setProperty('--accent-soft', c + '24');
  localStorage.setItem('fabri-theme', c);
  const t = document.getElementById('toast'); t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1200);
}}
document.getElementById('themes').addEventListener('click', (e) => {{
  if (e.target.dataset.c) setTheme(e.target.dataset.c);
}});
const saved = localStorage.getItem('fabri-theme');
if (saved) root.style.setProperty('--accent', saved);
document.getElementById('stamp').textContent = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
</script>
</body>
</html>
"""

out = ROOT / "docs" / "index.html"
out.write_text(HTML, encoding="utf-8")
print("sitio generado:", out, f"{len(HTML)//1024} KB")
