# Valutazione dell'orchestrazione

Misura se l'agente sceglie lo strumento giusto e se le risposte sono corrette, su domande realistiche con un
risultato atteso noto. È un test end-to-end: interroga l'API del back end come fa l'interfaccia, con il modello
vero, e quindi costa (pochi centesimi per esecuzione) e non fa parte di `npm test`.

```bash
# con back end, data agent e Chroma avviati (in locale o con docker compose)
node eval/run.mjs                                    # tutti i casi
node eval/run.mjs --only mix-make-good --repeat 3    # stabilità di un caso
node eval/run.mjs --base http://localhost:8080       # stack docker compose (passa da nginx)
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
atteso (espressioni regolari), **numeri** dal ground truth in formato italiano o inglese, voci che **non**
devono comparire (campagne escluse dal make-good), presenza del **grafico**, contenuto del **compito** passato
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
