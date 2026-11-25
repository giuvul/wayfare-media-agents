# Dizionario dati: `campagne_wayfare.csv`

Export giornaliero dell'ad server di Wayfare Media (azienda fittizia, dati sintetici).
Una riga = una campagna, in un aeroporto, in un giorno. Periodo: 1 gennaio 2025 - 30 settembre 2026
(data di estrazione). Le campagne a cavallo del periodo hanno dati parziali.

| Colonna | Tipo atteso | Descrizione |
|---|---|---|
| `id_riga` | testo | Identificativo univoco della riga nell'export (`R000001`). |
| `data` | data | Giorno di erogazione. Formato standard ISO `AAAA-MM-GG`; alcuni sistemi legacy esportano `GG/MM/AAAA` o la forma testuale italiana (`5 mar 2026`). |
| `id_campagna` | testo | Codice campagna (`WM-AAAA-NNNN`, anno di partenza del flight). |
| `inserzionista` | testo | Brand che acquista la campagna. |
| `settore` | categoria | Settore merceologico: Lusso, Moda, Beauty, Automotive, Finanza, Travel, Food & Beverage, Telco, Tecnologia. |
| `aeroporto` | categoria | Codice IATA: FCO, MXP, LIN, BGY, VCE, NAP, BLQ, CTA. |
| `terminal` | categoria | Terminal con l'inventario pianificato. |
| `formato` | categoria | Gate Screen, Digital Totem, Lounge Screen, Wi-Fi Portal, Baggage Claim Wall. |
| `segmento_audience` | categoria | Segmento target: Business, Leisure, Luxury Traveller, Famiglie, Giovani Esploratori. |
| `data_inizio_flight`, `data_fine_flight` | data (ISO) | Inizio e fine del flight contrattuale della campagna. |
| `impression_pianificate` | intero | Impression previste dal piano media per quel giorno e aeroporto. |
| `impression_erogate` | intero | Impression effettivamente erogate (certificate dall'ad server). |
| `reach` | intero | Passeggeri unici raggiunti nel giorno. **Non additiva** tra giorni o aeroporti. |
| `dwell_medio_sec` | decimale | Tempo medio di esposizione in secondi. Valori plausibili: 1-1800. |
| `scansioni_qr` | intero | Scansioni del QR code della creatività. Non può superare le impression erogate. |
| `conversioni` | intero | Conversioni attribuite (es. coupon riscattato) entro 7 giorni dalla scansione. |
| `cpm_listino` | decimale (EUR) | CPM di listino del formato. |
| `cpm_contrattuale` | decimale (EUR) | CPM effettivamente negoziato (listino meno sconti). Alcuni export lo scrivono come testo in formato valuta italiano (`12,50 €`). |
| `spesa_eur` | decimale (EUR) | Importo fatturabile della riga = `impression_erogate × cpm_contrattuale / 1000`. |
| `creativita_in_ritardo` | booleano | `True` se il cliente ha consegnato le creatività oltre la scadenza contrattuale. |

## Regole di qualità e di calcolo (concordate con il team Media Sales)

1. Ogni `id_riga` deve comparire una sola volta: righe ripetute sono export duplicati e vanno rimosse.
2. Testi di categoria (settore, aeroporto) vanno normalizzati: spazi, maiuscole/minuscole e sinonimi inglesi (es. `Luxury` = Lusso, `Fashion` = Moda, `Tech` = Tecnologia).
3. `impression_erogate` mancante o negativa indica un errore di log: la riga è **non valida** ed è esclusa da tutti i KPI (sia pianificato sia erogato, sia spesa), come previsto dalla metodologia di misurazione.
4. `spesa_eur` mancante su una riga valida si ricalcola con la formula sopra.
5. `scansioni_qr` superiori alle impression e `dwell_medio_sec` fuori dall'intervallo 1-1800 sono valori impossibili: vanno trattati come mancanti, senza eliminare la riga.
6. `segmento_audience` mancante si etichetta "Non classificato".
7. Il CPM effettivo di un aggregato si calcola come `somma(spesa) / somma(impression_erogate) × 1000`, mai come media dei CPM di riga.
8. La reach non si somma: per aggregati usare le impression o dichiarare che la reach è giornaliera.
