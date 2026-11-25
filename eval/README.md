# Valutazione dell'orchestrazione

Misura se l'agente sceglie lo strumento giusto e se le risposte sono corrette, su domande realistiche con un
risultato atteso noto. È un test end-to-end: interroga l'API del back end come fa l'interfaccia, con il modello
vero, e quindi costa (pochi centesimi per esecuzione) e non fa parte di `npm test`.

```bash
# con back end, data agent e Chroma avviati (in locale o con docker compose)
node eval/run.mjs                                    # tutti i casi
node eval/run.mjs --only mix-make-good --repeat 3    # stabilità di un caso
node eval/run.mjs --base http://localhost:8080       # stack docker compose (passa da nginx)
node eval/run.mjs --rescore eval/results/<report>.json   # ricalcola i controlli sulle risposte salvate
```

Il report va in `eval/results/` in Markdown e JSON (ogni turno con strumenti, input, motivo, fonti, tempi e
risposta). Il costo è letto dal consumo della chiave OpenRouter esposto da `/api/settings`: lo script non legge
mai la chiave.

## Casi

I 20 casi sono in [`cases.json`](cases.json), in cinque categorie:

| Categoria | Casi | Cosa verifica |
|---|---|---|
| Documentazione | 7 | Ricerca nell'handbook, citazione della sezione giusta, contenuto della regola; una domanda senza risposta nella documentazione (l'agente deve dirlo, non inventare) |
| Dati | 5 | Analisi con numeri confrontati con il ground truth del generatore (tolleranza 0,5%), grafico quando richiesto |
| Regola applicata ai dati | 3 | Prima la regola, poi l'analisi: make-good con esclusioni, sconti fuori policy, lavori a Venezia |
| Conversazione e fuori ambito | 3 | Saluto, meteo, richiesta di codice: nessuno strumento |
| Domande di seguito | 2 | "E per Malpensa?" deve diventare un compito completo per l'analista; "e se mancano 5 giorni?" sulla regola già recuperata |

Per ogni caso: **percorso** degli strumenti (accettati, il primo è l'ottimale: per esempio `data` o `kb>data`
per il CPM effettivo, perché consultare prima la definizione è legittimo), **citazioni** `[§x.y]`, **testo**
atteso (espressioni regolari), **numeri** dal ground truth in formato italiano o inglese (anche "230,6 milioni"),
presenza del **grafico**, contenuto del **compito** passato
all'analista.

## Risultati

Modello `deepseek/deepseek-v4.1-flash` (il modello economico usato in sviluppo), embedding Nemotron 3.5 Embed.
Report completo: [`results/202611251813_deepseek-deepseek-v4.1-flash.md`](results/202611251813_deepseek-deepseek-v4.1-flash.md).

| Misura | Risultato |
|---|---|
| Percorso degli strumenti corretto | **20/20** (ottimale 18/20) |
| Casi con tutti i controlli superati | **19/20** |
| Tempo per risposta | mediana 5,3 s, 90° percentile 28,3 s, massimo 35,5 s |
| Costo dell'intera valutazione | 0,047 USD |

Il caso non superato (`mix-sconti-fuori-policy`) trova le 7 campagne fuori policy con le percentuali corrette,
ma per alcune scrive solo l'inserzionista e rimanda il codice alla tabella mostrata sotto la risposta, mentre il
prompt chiede di indicarlo sempre. Il controllo resta severo di proposito.

**Stabilità** dei casi più difficili, ripetuti 3 volte ciascuno con la versione finale: make-good 3/3,
lavori a Venezia 3/3, sconti fuori policy 2/3 (stesso motivo), tempo massimo 65 s su 120 disponibili.

## Confronto tra modelli

Stessi 20 casi più 3 ripetizioni dei casi "regola applicata ai dati", con tre modelli della stessa fascia (piccoli,
veloci ed economici) di tre fornitori, scelti dalle Impostazioni così che li usino sia l'orchestratore sia
l'analista. Il modello di riserva è disattivato (`LLM_FALLBACK_MODELS` vuoto): con la riserva attiva OpenRouter
può rispondere con un altro modello senza segnalarlo. Report in
[`results/confronto-2026-11-25/`](results/confronto-2026-11-25/).

| Modello | Prezzo $/M (in/out) | Percorso corretto | Superati | Ripetizioni (9) | Mediana | 90° perc. | Costo* |
|---|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0,05 / 0,20 | 20/20 | 19/20 | 9/9 | 4,1 s | 25,2 s | 0,030 $ |
| `anthropic/claude-haiku-5.5` | 0,10 / 0,50 | 20/20 | **20/20** | **9/9** | 5,4 s | 41,8 s | 0,058 $ |
| `openai/gpt-6-luna` | 0,10 / 0,50 | 18/20 | 17/20 | 7/9 | 5,0 s | 21,2 s | 0,011 $ |

\* Costo del giro completo da 20 casi, orchestratore e analista insieme.

- **Claude Haiku 5.5** è l'unico a superare tutti i controlli, ripetizioni comprese. È il più lento sui casi con
  analisi dei dati (90° percentile 42 s), restando comunque lontano dal limite di 120 s.
- **DeepSeek V4.1 Flash** è il più veloce. Il suo unico errore è ricorrente: negli elenchi a volte scrive solo
  l'inserzionista e rimanda il codice campagna alla tabella.
- **GPT-6 Luna** costa meno degli altri sull'intero giro, perché genera meno token. Due casi su 20 sono falliti
  per sovraccarico del provider ("Il modello AI è momentaneamente sovraccarico"): un problema di disponibilità,
  che in produzione il modello di riserva copre. Nel caso del CPM per formato la risposta non riporta i numeri e
  rimanda a valori "riportati sopra"; negli sconti fuori policy omette i codici come DeepSeek.

**Problema emerso dal confronto.** Al primo tentativo Haiku 5.5 e GPT-6 Luna fallivano tutte le richieste in
0,1 s. I modelli più recenti di Anthropic e OpenAI non accettano il parametro `temperature`, e l'app chiede a
OpenRouter di usare solo provider che supportano tutti i parametri (`require_parameters`): nessun provider
risultava compatibile e la richiesta veniva rifiutata (404). Con il modello di riserva attivo l'app passava in
silenzio a quello, quindi chi sceglieva Haiku nelle Impostazioni riceveva risposte da un altro modello. Ora la
temperatura viene inviata solo ai modelli che la supportano secondo il catalogo OpenRouter.

**Controlli corretti dopo la lettura delle risposte.** Due fallimenti di DeepSeek erano falsi negativi del
controllo, non errori del modello: "230,6 milioni" di impression non era riconosciuto come numero (ora i valori
in "mila", "milioni" e "mln" sono convertiti, con la stessa tolleranza dello 0,5%), e una campagna esclusa dal
make-good compariva legittimamente nell'elenco delle esclusioni (il controllo "non deve comparire" è stato
rimosso: il valore totale verifica già che le esclusioni siano applicate). I controlli aggiornati sono stati
riapplicati a tutti i report con `--rescore`, senza nuove chiamate ai modelli, così le regole sono le stesse per
tutti.

## Cosa ha fatto emergere

La prima esecuzione aveva già il percorso corretto in 20 casi su 20, ma le ripetizioni dei casi "regola applicata
ai dati" hanno mostrato turni fino a 115 s, a un passo dal timeout della chat (120 s). Dai report JSON e dal
codice eseguito dall'analista sono emerse tre cause, corrette una per una:

1. **Analisi ripetute.** Se l'analista esauriva passi o tempo, l'orchestratore lo richiamava e il turno
   raddoppiava. Correzione: la scadenza del turno viene propagata fino al data agent (vedi
   [architettura, §6](../docs/architettura.md#6-tempi-catena-dei-timeout-e-scadenza-del-turno)) e un'analisi
   interrotta torna come `completa: false`, con l'indicazione di non ripeterla.
2. **Ricontrollo dei dati già puliti.** Leggendo "escludi i giorni con dato mancante" nel compito, l'analista
   ricontrollava la qualità dei dati invece di usare `df`, che applica già quella regola. Correzione: il prompt
   dell'analista dice che la pulizia è già verificata.
3. **Deduzione di informazioni assenti.** L'esclusione "campagne sospese su richiesta del cliente" non ha un
   campo nel dataset: l'analista provava a dedurla dai buchi nelle date e consumava il tempo. Correzione: le
   regole che richiedono informazioni assenti vanno dichiarate non verificabili, non dedotte.

Effetto sui casi "regola applicata ai dati": tempo massimo da 115 s a 65 s; make-good da 1/3 (con la sola
scadenza propagata, prima delle correzioni ai prompt) a 3/3.

## Limiti

- 20 casi danno un segnale sui percorsi e sugli errori sistematici, non una stima statistica precisa.
- I controlli sul testo sono espressioni regolari: una risposta corretta formulata in modo inatteso può non
  superarli (e viceversa). Per questo il report JSON conserva le risposte, da rileggere quando un caso fallisce.
- Con un modello economico l'esito di un caso difficile varia tra un'esecuzione e l'altra: conviene ripeterli
  (`--repeat`) prima di trarre conclusioni.
