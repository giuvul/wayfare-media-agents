# Valutazione dell'orchestrazione

- Data: 2026-11-25 19:24 UTC
- Modello: `anthropic/claude-haiku-5.5`
- Casi superati (tutti i controlli): **20/20**
- Percorso degli strumenti corretto: **20/20** (ottimale 18/20)
- Turni finiti in errore (provider o app): 0
- Tempo per risposta: mediana 5.4 s, 90° percentile 41.8 s
- Costo totale: 0.0578 USD
- Controlli ricalcolati il 2026-11-25 19:41 UTC sulle risposte salvate

| Categoria | Casi | Percorso corretto | Superati |
|---|---|---|---|
| documentazione | 7 | 7 | 7 |
| dati | 5 | 5 | 5 |
| regola applicata ai dati | 3 | 3 | 3 |
| conversazione e fuori ambito | 3 | 3 | 3 |
| domande di seguito | 2 | 2 | 2 |

| Caso | Esito | Percorso | Tempo | Controlli non superati |
|---|---|---|---|---|
| `kb-cancellazione` | superato | kb | 3.6 s |  |
| `kb-opzione` | superato | kb | 3.6 s |  |
| `kb-tetto-sconto` | superato | kb | 3.8 s |  |
| `kb-alcolici` | superato | kb | 5.4 s |  |
| `kb-reach` | superato | kb | 4.8 s |  |
| `kb-attribuzione` | superato | kb | 2.7 s |  |
| `kb-assente` | superato | kb | 3.9 s |  |
| `data-cpm-formato` | superato | kb>data | 17.2 s |  |
| `data-campagne` | superato | data | 19.1 s |  |
| `data-impression-totali` | superato | data | 13.9 s |  |
| `data-qr-lusso` | superato | kb>data | 43.5 s |  |
| `data-grafico-mensile` | superato | data | 15.7 s |  |
| `mix-make-good` | superato | kb>data | 31.6 s |  |
| `mix-sconti-fuori-policy` | superato | kb>data | 23.3 s |  |
| `mix-venezia` | superato | kb>data | 41.8 s |  |
| `conv-saluto` | superato | none | 2.0 s |  |
| `conv-meteo` | superato | none | 1.4 s |  |
| `conv-codice` | superato | none | 2.5 s |  |
| `seguito-aeroporto` | superato | data | 23.1 s |  |
| `seguito-penale` | superato | none | 1.2 s |  |
