"""Converte la knowledge base da Markdown a PDF (data/kb/wayfare_media_handbook.pdf).

Il PDF è già incluso nel repository: questo script serve solo se si modifica il Markdown.
Uso:
    pip install -r data/generator/requirements-pdf.txt && playwright install chromium
    python data/generator/build_kb_pdf.py
"""

from __future__ import annotations

import re
from pathlib import Path

import markdown
from playwright.sync_api import sync_playwright

KB_DIR = Path(__file__).resolve().parents[1] / "kb"
SRC = KB_DIR / "wayfare_media_handbook.md"
OUT = KB_DIR / "wayfare_media_handbook.pdf"

CSS = """
@page { size: A4; margin: 22mm 20mm 20mm 20mm; }
body { font-variant-ligatures: none; font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d2330; }
.cover { height: 230mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover .brand { font-size: 13pt; letter-spacing: .3em; color: #0f6e7a; font-weight: 700; }
.cover h1 { font-size: 26pt; margin: 8mm 0 4mm; border: 0; }
.cover .sub { font-size: 13pt; color: #4a5568; }
.cover .meta { margin-top: 18mm; font-size: 10pt; color: #4a5568; }
.cover .disclaimer { margin-top: 40mm; font-size: 8.5pt; color: #718096; }
h1 { font-size: 16pt; color: #0f6e7a; border-bottom: 1.5px solid #0f6e7a; padding-bottom: 2mm; margin-top: 9mm; page-break-after: avoid; }
h2 { font-size: 12pt; color: #1d2330; margin-top: 6mm; page-break-after: avoid; }
p, li { text-align: justify; }
strong { color: #0b4f58; }
"""


def main() -> None:
    testo = SRC.read_text(encoding="utf-8")
    front, corpo = re.match(r"^---\n(.*?)\n---\n(.*)$", testo, re.S).groups()
    meta = dict(re.findall(r'^(\w+):\s*"(.*)"$', front, re.M))
    cover = f"""
    <section class="cover">
      <div class="brand">WAYFARE MEDIA</div>
      <h1>{meta['title'].split(' — ')[1]}</h1>
      <div class="sub">{meta['subtitle']}</div>
      <div class="meta">{meta['version']}<br>{meta['audience']}</div>
      <div class="disclaimer">Documento di esempio per un progetto didattico: Wayfare Media è un'azienda fittizia
      e tutti i contenuti sono sintetici.</div>
    </section>"""
    html = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{cover}{markdown.markdown(corpo)}</body></html>"
    footer = ("<div style='font-size:8px;width:100%;padding:0 20mm;color:#718096;display:flex;justify-content:space-between'>"
              "<span>Wayfare Media — Handbook commerciale e operativo</span>"
              "<span>Pagina <span class='pageNumber'></span> di <span class='totalPages'></span></span></div>")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html, wait_until="load")
        page.pdf(path=str(OUT), format="A4", display_header_footer=True, header_template="<span></span>",
                 footer_template=footer, margin={"top": "22mm", "bottom": "20mm", "left": "20mm", "right": "20mm"})
        browser.close()
    print(f"scritto {OUT}")


if __name__ == "__main__":
    main()
