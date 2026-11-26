# Valutazione dell'orchestrazione

- Data: 2026-11-26 11:37 UTC
- Modello: `anthropic/claude-haiku-5.5`
- Casi superati (tutti i controlli): **20/20**
- Percorso degli strumenti corretto: **20/20** (ottimale 18/20)
- Turni finiti in errore (provider o app): 0
- Tempo per risposta: mediana 4.4 s, 90° percentile 38.4 s
- Costo totale: 0.0508 USD

| Categoria | Casi | Percorso corretto | Superati |
|---|---|---|---|
| documentazione | 7 | 7 | 7 |
| dati | 5 | 5 | 5 |
| regola applicata ai dati | 3 | 3 | 3 |
| conversazione e fuori ambito | 3 | 3 | 3 |
| domande di seguito | 2 | 2 | 2 |

| Caso | Esito | Percorso | Tempo | Controlli non superati |
|---|---|---|---|---|
| `kb-cancellazione` | superato | kb | 3.8 s |  |
| `kb-opzione` | superato | kb | 3.6 s |  |
| `kb-tetto-sconto` | superato | kb | 4.1 s |  |
| `kb-alcolici` | superato | kb | 4.4 s |  |
| `kb-reach` | superato | kb | 3.8 s |  |
| `kb-attribuzione` | superato | kb | 2.8 s |  |
| `kb-assente` | superato | kb | 4.3 s |  |
| `data-cpm-formato` | superato | kb>data | 23.5 s |  |
| `data-campagne` | superato | data | 10.8 s |  |
| `data-impression-totali` | superato | data | 9.0 s |  |
| `data-qr-lusso` | superato | kb>data | 22.5 s |  |
| `data-grafico-mensile` | superato | data | 10.9 s |  |
| `mix-make-good` | superato | kb>data | 38.4 s |  |
| `mix-sconti-fuori-policy` | superato | kb>data | 24.9 s |  |
| `mix-venezia` | superato | kb>data | 38.5 s |  |
| `conv-saluto` | superato | none | 2.3 s |  |
| `conv-meteo` | superato | none | 1.5 s |  |
| `conv-codice` | superato | none | 2.3 s |  |
| `seguito-aeroporto` | superato | data | 14.1 s |  |
| `seguito-penale` | superato | none | 1.2 s |  |
