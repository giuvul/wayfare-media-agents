# Changelog

Tutte le modifiche rilevanti al progetto, dalla più recente. Il formato segue
[Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/); ogni voce corrisponde a un commit
(hash abbreviato), perché il progetto non ha ancora versioni rilasciate.

## [Non rilasciato]

### Corretto
- Il ragionamento dell'agente compariva per un istante come inizio della risposta e solo dopo si spostava nel
  pannello del ragionamento. Ora ogni strumento ha un parametro `motivo` (una frase per l'utente) che arriva
  insieme alla chiamata; come rete di sicurezza, il testo del modello viene trattenuto fino a 160 caratteri e,
  se segue una chiamata a uno strumento, non diventa mai risposta.

### Aggiunto
- Test dello streaming con un modello finto che emette testo e chiamate a pezzi, come un provider reale.
- Documentazione di progetto: README, `docs/architettura.md` (componenti, flussi, decisioni e limiti noti),
  questo changelog, `.env.example` con tutte le variabili.

## [ac52964] - 2026-11-25 - Embedding configurabili e analisi deterministica della qualità

### Aggiunto
- Scelta del modello di embedding dall'interfaccia: catalogo OpenRouter con ricerca, oppure modelli locali
  (Multilingual E5 Small e Base, BGE-M3) eseguiti con Transformers.js 4.3.2 su CPU.
- Valutazione delle risorse della macchina o del container (CPU, RAM disponibile, disco, piattaforma, libc)
  con un giudizio per modello basato su requisiti misurati.
- Download dei modelli locali in streaming su disco, con revisione fissata e SHA-256 verificato; a runtime
  nessun accesso a Hugging Face.
- Una collection Chroma per modello di embedding; il cambio di modello (download, indicizzazione, verifica)
  è un'operazione in background con avanzamento, e il nuovo modello diventa attivo solo se riesce.
- Soglia di pertinenza calibrata per modello su domande fuori tema.
- Analisi deterministica della qualità dei dati (`data_agent/app/quality.py`): controlli guidati dal
  dizionario dati su tutte le righe, con conteggi, esempi e valore canonico proposto.
- Scheda "Pulizia dei dati": tabella dell'analisi con le righe nel grezzo e dopo la pulizia.

### Modificato
- L'LLM che scrive il codice di pulizia riceve l'analisi completa invece di un profilo riassuntivo.
- La pulizia viene accettata solo se l'analisi rieseguita sui dati puliti non trova anomalie bloccanti.
- Il pulsante "Rigenera con l'AI" è nella card del codice di pulizia.
- `RAG_MIN_SIMILARITY` di default passa da 0,3 a 0,2.

### Corretto
- La soglia fissa di 0,3 escludeva alcune domande pertinenti con Nemotron e non filtrava nulla con i modelli E5.
- Il profilo per la pulizia perdeva gli esempi delle colonne con molti formati diversi e non contava le anomalie.

## [1a3f038] - 2026-11-25 - Cronologia, impostazioni, Knowledge Base e citazioni navigabili

### Aggiunto
- Citazioni `[§x.y]` cliccabili: pannello laterale (anche a schermo intero) con il documento e la sezione
  evidenziata; pulsante "Visualizza documento" dalle fonti.
- Cronologia delle conversazioni salvata in SQLite, raggruppata per giorno, con eliminazione (che rimuove anche
  memoria dell'agente e grafici).
- Memoria dell'agente persistente tra i riavvii (checkpointer SQLite al posto di quello in memoria).
- Impostazioni: chiave OpenRouter verificata prima del salvataggio, mascherata e mai restituita al browser;
  scelta del modello dal catalogo OpenRouter (solo modelli con tool calling) con ricerca e prezzi.
- Knowledge Base: documenti Markdown consultabili, modificabili con anteprima, creabili ed eliminabili, con
  reindicizzazione automatica; dati grezzi e puliti con ricerca, paginazione e modifica delle celle; dizionario
  dati modificabile; pulizia con statistiche, report, codice e rigenerazione con l'AI.
- Data agent: endpoint per dataset, modifica delle celle, dizionario e ricostruzione della pulizia; riuso del
  codice di pulizia già validato quando cambiano solo i dati, senza chiamate all'LLM.
- Modello e chiave scelti dall'interfaccia passati al data agent per singola richiesta.

### Modificato
- Interfaccia riorganizzata con barra laterale e navigazione (chat, Knowledge Base, Impostazioni).
- Il ragionamento dell'agente si accumula in un pannello richiudibile all'inizio del messaggio.
- Grafici, dati e fonti compaiono a risposta completa; i blocchi con solo codice vanno nel ragionamento.
- L'handbook è indicizzato dal Markdown (sezioni dai titoli); il PDF passa in `docs/` come esportazione.
  Le citazioni non riportano più la pagina.

### Corretto
- Pallini duplicati nell'elenco della pulizia dei dati (stile applicato anche alle liste annidate).
- `checkpoints.db` era creato leggibile da tutti gli utenti: ora ha permessi `0600` come `app.db`.

## [d9482d9] - 2026-11-25 - Front end

### Aggiunto
- Chat React + Vite con streaming degli eventi del turno (fetch e parser SSE), fasi di lavoro visibili e
  interruzione della risposta.
- Risposta in Markdown; scheda dell'analisi con grafico, tabella in formato italiano e codice eseguito.
- Fonti citate dall'handbook con estratto; pannello dei passaggi con compito, durata e report di pulizia.
- Stato dei servizi da `/api/health`, domande di esempio, layout responsive e tema scuro.

## [4f0b7da] - 2026-11-25 - Robustezza con modelli veloci

### Corretto
- Errore "il processo di esecuzione non si è avviato" con i modelli che chiamano più strumenti in parallelo:
  le esecuzioni nella sandbox ora sono serializzate.
- Analisi lunghe che andavano in timeout perdendo il lavoro: il data agent segue lo stato in streaming e, se
  finiscono passi o tempo, fa un'ultima chiamata senza strumenti con i risultati già ottenuti.
- Calcoli del make-good che ignoravano le esclusioni: l'orchestratore recupera condizioni ed esclusioni e
  scrive per l'analista un compito autosufficiente con la regola per esteso.

### Modificato
- Catena dei timeout: chat da 90 a 120 s; passi massimi del data agent da 8 a 10.

## [9d95230] - 2026-11-25 - Back end

### Aggiunto
- Orchestratore ReAct (`createAgent` di LangChain.js) con due strumenti `content_and_artifact`:
  `cerca_documentazione` (RAG) e `analizza_dati` (data agent).
- Middleware: limite di chiamate al modello, retry sugli errori del provider, context editing; memoria per
  conversazione.
- Indicizzazione idempotente (SHA-256) per sezioni dell'handbook, passaggi con intestazione di contesto,
  similarità coseno.
- API: `POST /api/chat` (JSON o SSE), proxy dei grafici, health check aggregato; helmet, CORS, rate limit,
  validazione con zod, errori per l'utente in italiano.
- Test offline con un modello finto deterministico.

## [6134c75] - 2026-11-25 - Data agent

### Aggiunto
- Microservizio FastAPI con autenticazione a token condiviso verso il back end.
- Pulizia dei dati scritta dall'LLM a partire da un profilo del CSV, validata con controlli deterministici e
  messa in cache.
- Agente pandas ReAct (`create_agent` di LangChain 1.x) con interprete Python isolato: policy statica
  sull'AST, processo `spawn` senza segreti, timeout per esecuzione.
- Grafici salvati automaticamente con tema coerente; tabella del risultato per la vista "Dati".
- Test offline (sandbox, validatore, API) e test con il modello reale contro il ground truth (`pytest -m llm`).

## [ec575a1] - 2026-11-25 - Dati sintetici

### Aggiunto
- Generatore riproducibile (seed fisso) del dataset delle campagne: 9.293 righe, gennaio 2025 - settembre 2026,
  con anomalie realistiche (duplicati, date in tre formati, CPM come testo in valuta italiana, categorie scritte
  in modi diversi, valori mancanti e impossibili).
- Ground truth: numero di anomalie iniettate e KPI attesi (CPM effettivo per formato, make-good, campagne con
  sconti fuori policy...), calcolati da una pulizia di riferimento che il data agent non vede.
- Dizionario dati con tipi, valori ammessi e regole di qualità e di calcolo.
- Handbook aziendale in 12 capitoli (formati, listino, condizioni di vendita, garanzia di erogazione e
  make-good, metodologia, policy sui contenuti, privacy, segmenti, FAQ) in Markdown e PDF.
- Configurazione del repository: `.gitignore` (segreti e dati di runtime esclusi), versioni di Node e Python.

[Non rilasciato]: https://github.com/giuvul/wayfare-media-agents/compare/ac52964...HEAD
[ac52964]: https://github.com/giuvul/wayfare-media-agents/commit/ac52964
[1a3f038]: https://github.com/giuvul/wayfare-media-agents/commit/1a3f038
[d9482d9]: https://github.com/giuvul/wayfare-media-agents/commit/d9482d9
[4f0b7da]: https://github.com/giuvul/wayfare-media-agents/commit/4f0b7da
[9d95230]: https://github.com/giuvul/wayfare-media-agents/commit/9d95230
[6134c75]: https://github.com/giuvul/wayfare-media-agents/commit/6134c75
[ec575a1]: https://github.com/giuvul/wayfare-media-agents/commit/ec575a1
