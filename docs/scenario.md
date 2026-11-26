# Scenario, knowledge base e dataset

Questo documento spiega lo scenario aziendale del progetto e come la documentazione (knowledge base) e il dataset
sono stati costruiti per raccontare la stessa azienda. Per come funziona il sistema vedi
[architettura.md](architettura.md); per la sicurezza [sicurezza.md](sicurezza.md).

## 1. L'azienda e chi usa l'assistente

**Wayfare Media** è una concessionaria pubblicitaria (fittizia) che vende spazi digitali in otto aeroporti
italiani: Roma Fiumicino (FCO), Milano Malpensa (MXP), Milano Linate (LIN), Bergamo (BGY), Venezia (VCE), Napoli
(NAP), Bologna (BLQ) e Catania (CTA). Vende cinque formati (Gate Screen, Digital Totem, Lounge Screen, Wi-Fi
Portal, Baggage Claim Wall) a prezzo CPM, cioè per mille impression erogate, con una garanzia di erogazione.

L'assistente è pensato per il reparto **Media Sales & Campaign Performance**: commerciali, account manager e
Campaign Operations. Nel loro lavoro quotidiano le domande sono di tre tipi:

| Tipo | Esempio | Dove sta la risposta |
|---|---|---|
| Regole e procedure | "Che penale paga un cliente se cancella a 10 giorni dall'inizio?" | Handbook (§4.3) |
| Numeri sulle campagne | "Qual è il CPM effettivo per formato?" | Dataset delle campagne |
| Regole applicate ai dati | "Quali campagne hanno diritto a un make-good?" | Handbook (§5) + dataset |

Il terzo tipo è il più utile e il più difficile, ed è il motivo per cui l'assistente ha due strumenti invece di
uno: oggi richiede di leggere il contratto e poi incrociarlo a mano con l'export dell'ad server.

## 2. La knowledge base

[`data/kb/wayfare_media_handbook.md`](../data/kb/wayfare_media_handbook.md) è l'handbook commerciale e operativo
(versione 3.2, settembre 2026), scritto come un vero documento interno: 12 capitoli e 39 passaggi indicizzati.
[`docs/wayfare_media_handbook.pdf`](wayfare_media_handbook.pdf) è la stessa versione esportata in PDF.

| Capitolo | Contenuto | Usato dai dati? |
|---|---|---|
| 1. Chi siamo | Rete di aeroporti, promessa di misurabilità | Sì: gli 8 aeroporti del dataset |
| 2. Formati | I cinque formati; §2.6 scadenza di consegna delle creatività | Sì: `formato`, `creativita_in_ritardo` |
| 3. Listino e sconti | §3.1 CPM di listino, §3.2 sconti volume, §3.3 tetto del 25% | Sì: `cpm_listino`, `cpm_contrattuale` |
| 4. Condizioni di vendita | Opzione, pagamento, §4.3 penali di cancellazione, modifiche | No: solo documentazione |
| 5. Garanzia e make-good | §5.1 garanzia al 95%, §5.2 calcolo, §5.3 esclusioni, §5.4 lavori a Venezia | Sì: il caso misto principale |
| 6. Metodologia | Impression, reach, dwell, QR, §6.5 CPM effettivo, §6.6 dati mancanti | Sì: definisce come si calcolano i KPI |
| 7. Policy sui contenuti | Categorie vietate e con restrizioni (es. alcolici solo in Lounge e Baggage Claim) | Sì: rispettata dal generatore |
| 8-12 | Privacy, segmenti di audience, stagionalità, reclami, FAQ | In parte: segmenti e stagionalità |

Alcuni capitoli sono solo documentazione (penali, pagamento, reclami), perché nella realtà molte domande non
hanno bisogno di dati. Altri esistono apposta per essere applicati al dataset.

## 3. Il dataset

[`data/campagne_wayfare.csv`](../data/campagne_wayfare.csv) è l'export giornaliero dell'ad server: una riga per
campagna, aeroporto e giorno, dal 1° gennaio 2025 al 30 settembre 2026 (data di estrazione). Sono 9.293 righe
grezze, 177 campagne di 22 inserzionisti fittizi in nove settori. Le colonne sono descritte nel
[dizionario dati](../data/dizionario_dati.md), che contiene anche le regole di qualità e di calcolo concordate con
il reparto: è il documento da cui partono l'analisi della qualità e la pulizia.

## 4. Come regole e dati si incastrano

La tabella collega ogni regola dell'handbook alle colonne che servono per applicarla e al valore vero calcolato
dal generatore ([`ground_truth.json`](../data/generator/ground_truth.json)).

| Regola | Colonne | Domanda tipo | Valore atteso |
|---|---|---|---|
| §5.1-5.3 make-good: campagna conclusa, erogato sotto il 95%, creatività in tempo | `data_fine_flight`, `impression_pianificate`, `impression_erogate`, `cpm_contrattuale`, `creativita_in_ritardo` | Quali campagne hanno diritto a un make-good? | 18 campagne, 30.450,54 €; 14 campagne escluse per creatività in ritardo |
| §5.4 lavori a Venezia, 12 gennaio - 29 marzo 2026 | `aeroporto`, `data`, impression | Com'è andata l'erogazione a Venezia nel 2026? | tasso di erogazione VCE: 83% a gennaio, 80% a febbraio, 75% a marzo, 98% ad aprile |
| §3.3 sconto complessivo massimo 25% | `cpm_listino`, `cpm_contrattuale` | Ci sono contratti fuori policy? | 7 campagne, con sconti dal 29% al 32% |
| §6.5 CPM effettivo = spesa / erogato × 1000, mai la media dei CPM | `spesa_eur`, `impression_erogate`, `formato` | CPM effettivo per formato | da 8,35 € (Wi-Fi Portal) a 31,84 € (Lounge Screen) |
| §6.6 giorni con erogato mancante o negativo esclusi da pianificato ed erogato | `impression_erogate` | (si applica a ogni KPI) | 145 righe escluse dai KPI |
| §7.2 alcolici solo in Lounge Screen e Baggage Claim Wall | `inserzionista`, `formato` | (coerenza del dataset) | l'unico inserzionista di alcolici compare solo in quei due formati |
| §2.3 Lounge Screen solo negli aeroporti con lounge | `formato`, `aeroporto` | (coerenza del dataset) | Lounge Screen solo a FCO, MXP, LIN, VCE e NAP |
| §10 stagionalità: luglio e agosto sopra la media, gennaio, febbraio e novembre i mesi più deboli | `data`, impression | Andamento mensile delle impression | luglio 2025 è il mese più alto (23,5 milioni) |

Le regole di business del generatore (listino, soglie di sconto, soglia del 95%, date dei lavori a Venezia) sono
costanti in testa a [`generate_dataset.py`](../data/generator/generate_dataset.py), sotto il commento "devono
coincidere con la knowledge base". Se l'handbook cambia, si cambiano lì e si rigenerano dataset e ground truth.

## 5. Le anomalie, e perché ci sono

Un export reale non è mai pulito, e un agente che lavora sui dati deve accorgersene. Il generatore produce prima
il dataset pulito, poi lo sporca in modo controllato e registra quante anomalie ha inserito:

| Anomalia | Righe | Cosa mette alla prova |
|---|---|---|
| Righe duplicate | 182 | deduplica prima di ogni somma |
| Settore scritto in modi diversi (`Luxury`, ` lusso `) | 547 | normalizzazione delle categorie |
| Aeroporto scritto in modi diversi | 182 | normalizzazione delle categorie |
| Date in formato `GG/MM/AAAA` o testuale (`5 mar 2026`) | 1.822 + 729 | parsing delle date |
| CPM come testo in valuta (`12,50 €`) | 1.367 | conversione dei numeri |
| Flag delle creatività come testo (`sì`, `1`) | 456 | conversione dei booleani |
| Erogato mancante o negativo | 109 + 36 | esclusione della riga dai KPI (§6.6) |
| Spesa mancante | 137 | ricalcolo dalla formula |
| QR più delle impression, dwell fuori range | 27 + 27 | valori impossibili trattati come mancanti, senza scartare la riga |
| Segmento mancante | 91 | etichetta "Non classificato" |

Il generatore contiene anche una **pulizia di riferimento** (`reference_clean`) che applica le regole del
dizionario. È da lì che escono i valori del ground truth, ed è il termine di paragone per la pulizia scritta
dall'AI nel data agent: i test e la [valutazione](../eval/README.md) confrontano i numeri dell'assistente con
questi valori.

## 6. Riproducibilità

Tutto esce da un seed fisso (`SEED = 23`): rieseguendo il generatore si ottengono lo stesso CSV, lo stesso
ground truth e lo stesso PDF dell'handbook.

```bash
cd data/generator
python generate_dataset.py      # dataset e ground truth
python build_kb_pdf.py          # PDF dell'handbook (requirements-pdf.txt)
```

## 7. Cosa non c'è nei dati

Alcune regole dell'handbook non si possono verificare sul dataset, e l'assistente deve dirlo invece di
inventare. Il caso più evidente: il §5.3 esclude dal make-good le campagne sospese o modificate su richiesta del
cliente, ma l'export dell'ad server non ha un campo per saperlo, e la risposta sul make-good lo segnala. Lo stesso vale per le penali di cancellazione (§4.3): il
dataset non contiene le cancellazioni, quindi sono domande da sola documentazione.
