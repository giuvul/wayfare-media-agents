# Brand Wayfare Media

Identità visiva dell'interfaccia: direzione "Modernismo italiano", la grafica italiana degli anni '60 con forme
geometriche piatte e colori pieni.

| File | Contenuto |
|---|---|
| `wayfare-simbolo.svg` | Simbolo: due triangoli, oltremare `#20419C` e vermiglio `#E44325`, che formano una W |
| `wayfare-wordmark.svg` | Logotipo "Wayfare Media" (grottesco pesante), in nero |
| `Banner-Hero.png`, `Banner-Hero-Dark.png` | Banner della schermata iniziale, per tema chiaro e scuro (nell'app in WebP, `frontend/src/assets/`) |
| `wayfare-design-system.png` | Tavola di riferimento: palette, tipografia, componenti e schermata della chat |

I tracciati del simbolo e del logotipo sono usati così come sono in `frontend/src/components/Brand.jsx`
(cambia solo il viewBox, che ritaglia il disegno) e nella favicon. Sulla barra laterale oltremare il triangolo
sinistro diventa avorio.

## Palette

| Nome | Colore | Uso |
|---|---|---|
| Avorio | `#F2EEE3` | sfondo delle pagine |
| Oltremare | `#2643A8` | azioni principali, barra laterale, link e citazioni |
| Vermiglio | `#E4472E` | accento: voce attiva, scheda attiva, icone, errori |
| Ocra | `#E3A72F` | evidenziazione nei documenti, avvisi |
| Nero | `#1A1A1A` | testo |
| Oliva | `#6E7F3E` | conferme |

Dove un colore del brand non raggiunge il contrasto WCAG AA come colore di testo (ocra, oliva, vermiglio su
avorio) il testo usa una variante più scura, e il colore pieno resta per bordi, icone e superfici. Il tema scuro
usa le stesse tinte, schiarite. Tutte le coppie testo/sfondo sono a 4,5:1 o più.

**Grafici** (matplotlib, `data_agent/app/sandbox.py`): oltremare `#3651BC`, vermiglio `#E4472E`, ocra
`#E3A72F`, oliva `#6F8C2B`, più un neutro per "Altro". Oltremare e oliva sono leggermente schiariti e saturati
rispetto al brand perché le serie restino distinguibili anche con deficit nella visione dei colori; l'ocra ha
poco contrasto sul fondo, compensato dalla tabella dei dati sempre affiancata al grafico.

## Tipografia

- Titoli: **Figtree** (800–900), un grottesco vicino al logotipo.
- Interfaccia e testi: **Inter**.

Entrambi con licenza SIL Open Font License, inclusi nel build tramite i pacchetti `@fontsource-variable`: nessun
font caricato da servizi esterni.
