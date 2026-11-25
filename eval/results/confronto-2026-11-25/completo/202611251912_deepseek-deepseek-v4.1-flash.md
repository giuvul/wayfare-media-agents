# Valutazione dell'orchestrazione

- Data: 2026-11-25 19:12 UTC
- Modello: `deepseek/deepseek-v4.1-flash`
- Casi superati (tutti i controlli): **19/20**
- Percorso degli strumenti corretto: **20/20** (ottimale 18/20)
- Turni finiti in errore (provider o app): 0
- Tempo per risposta: mediana 4.1 s, 90° percentile 25.2 s
- Costo totale: 0.0303 USD
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
| `kb-cancellazione` | superato | kb | 3.4 s |  |
| `kb-opzione` | superato | kb | 2.3 s |  |
| `kb-tetto-sconto` | superato | kb | 3.9 s |  |
| `kb-alcolici` | superato | kb | 3.8 s |  |
| `kb-reach` | superato | kb | 3.6 s |  |
| `kb-attribuzione` | superato | kb | 2.7 s |  |
| `kb-assente` | superato | kb | 4.1 s |  |
| `data-cpm-formato` | superato | kb>data | 15.5 s |  |
| `data-campagne` | superato | data | 9.4 s |  |
| `data-impression-totali` | superato | data | 10.7 s |  |
| `data-qr-lusso` | superato | kb>data | 22.7 s |  |
| `data-grafico-mensile` | superato | data | 17.1 s |  |
| `mix-make-good` | superato | kb>data | 26.9 s |  |
| `mix-sconti-fuori-policy` | non superato | kb>data | 23.3 s | contiene /WM-2025-0079/; contiene /WM-2025-0022/ |
| `mix-venezia` | superato | kb>data | 25.2 s |  |
| `conv-saluto` | superato | none | 2.1 s |  |
| `conv-meteo` | superato | none | 1.4 s |  |
| `conv-codice` | superato | none | 2.2 s |  |
| `seguito-aeroporto` | superato | data | 15.0 s |  |
| `seguito-penale` | superato | none | 2.0 s |  |
