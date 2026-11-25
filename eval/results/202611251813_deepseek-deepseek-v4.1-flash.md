# Valutazione dell'orchestrazione

- Data: 2026-11-25 18:13 UTC
- Modello: `deepseek/deepseek-v4.1-flash`
- Casi superati (tutti i controlli): **19/20**
- Percorso degli strumenti corretto: **20/20** (ottimale 18/20)
- Turni finiti in errore (provider o app): 0
- Tempo per risposta: mediana 5.3 s, 90° percentile 28.3 s
- Costo totale: 0.0474 USD
- Controlli ricalcolati il 2026-11-25 19:41 UTC sulle risposte salvate

| Categoria | Casi | Percorso corretto | Superati |
|---|---|---|---|
| documentazione | 7 | 7 | 7 |
| dati | 5 | 5 | 5 |
| regola applicata ai dati | 3 | 3 | 2 |
| conversazione e fuori ambito | 3 | 3 | 3 |
| domande di seguito | 2 | 2 | 2 |

| Caso | Esito | Percorso | Tempo | Controlli non superati |
|---|---|---|---|---|
| `kb-cancellazione` | superato | kb | 3.6 s |  |
| `kb-opzione` | superato | kb | 2.5 s |  |
| `kb-tetto-sconto` | superato | kb | 5.3 s |  |
| `kb-alcolici` | superato | kb | 4.4 s |  |
| `kb-reach` | superato | kb | 3.7 s |  |
| `kb-attribuzione` | superato | kb | 2.7 s |  |
| `kb-assente` | superato | kb | 3.2 s |  |
| `data-cpm-formato` | superato | kb>data | 21.3 s |  |
| `data-campagne` | superato | data | 10.4 s |  |
| `data-impression-totali` | superato | data | 11.5 s |  |
| `data-qr-lusso` | superato | kb>data | 28.3 s |  |
| `data-grafico-mensile` | superato | data | 20.2 s |  |
| `mix-make-good` | superato | kb>data | 27.2 s |  |
| `mix-sconti-fuori-policy` | non superato | kb>data | 25.1 s | contiene /WM-2025-0022/ |
| `mix-venezia` | superato | kb>data | 35.5 s |  |
| `conv-saluto` | superato | none | 2.1 s |  |
| `conv-meteo` | superato | none | 1.8 s |  |
| `conv-codice` | superato | none | 2.0 s |  |
| `seguito-aeroporto` | superato | data | 13.2 s |  |
| `seguito-penale` | superato | none | 1.5 s |  |
