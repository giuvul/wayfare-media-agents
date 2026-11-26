# Changelog

Tutte le modifiche rilevanti al progetto, dalla più recente. Il formato segue
[Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/); ogni voce corrisponde a un commit
(hash abbreviato), perché il progetto non ha ancora versioni rilasciate.

## [Non rilasciato]

Revisione completa del sistema (front end, back end, data agent, configurazione), con revisori indipendenti.

### Sicurezza
- Sandbox del data agent: il figlio risponde in JSON e il server non deserializza più oggetti arbitrari; i pickle
  di dataset e cache passano da un unpickler ristretto (`app/safe_pickle.py`). Limiti di CPU, memoria (3 GB) e
  dimensione dei file; output e grafici limitati. Policy estesa a `from ... import`, nomi speciali, memoria
  mappata, estensioni C, `to_string` su file e stringhe con URL o percorsi di sistema.
- Chiave OpenRouter e token interno tolti dall'ambiente del data agent all'avvio: i processi della sandbox non li
  ereditano più (prima erano leggibili da `/proc/self/environ`).
- `DATA_AGENT_TOKEN` obbligatorio di almeno 16 caratteri anche nel data agent; `.env.example` non ha più un
  valore segnaposto utilizzabile.
- Errori 4xx con soli messaggi scritti per l'utente (`HttpError`); niente dettagli interni delle librerie.
- Cartella `storage/` e file WAL di SQLite con permessi riservati al proprietario.
- Intestazioni di sicurezza (CSP, `nosniff`, `Referrer-Policy`) anche sulle pagine statiche servite da nginx;
  Chroma senza capability e con `no-new-privileges`.

### Corretto
- Dopo uno Stop o un timeout durante uno strumento, il messaggio successivo nella stessa conversazione poteva
  fallire: la chiamata rimasta senza risultato viene chiusa prima della nuova domanda.
- Una conversazione poteva restare bloccata ("risposta in corso") se il salvataggio di un messaggio falliva.
- Salvando chiave e modello insieme, una chiave valida veniva salvata anche se il modello era rifiutato.
- Doppio clic su "Usa" nel cambio del modello di embedding: potevano partire due cambi.
- Analisi dei dati: il budget ora include il margine con cui la richiesta attende la conclusione, e una singola
  esecuzione non supera mai il tempo rimasto; il client HTTP non ritenta più per conto proprio.
- Documentazione non raggiungibile: lo strumento restituisce un errore gestito invece di far fallire il turno.
- Un turno senza testo finale mostra un messaggio invece di una risposta vuota.
- All'arresto del server i turni in corso terminano subito, salvati con un messaggio che invita a riprovare.
- L'indicizzazione da riga di comando usa anche la chiave impostata dall'interfaccia.
- Il pannello del documento restava aperto passando alla Knowledge Base o alle Impostazioni.
- Il data agent legge CSV e dizionario una sola volta per impronta e pulizia; due ricostruzioni contemporanee non
  partono più entrambe.

### Modificato
- Lint in tutti i componenti: ESLint (con le regole degli hook di React) per back end e front end, Ruff per il
  data agent; strumenti di test e lint del data agent in `requirements-dev.txt`, fuori dall'immagine.
- Front end: hook condivisi (`usePolling`, `useDebouncedValue`, `useCatalogSearch`) e componente `ModelRow` al
  posto di logica duplicata; stato derivato invece di effetti che reimpostano lo stato.
- Back end: rimosso `asyncRoute` (Express 5 inoltra già gli errori delle route asincrone); parametri di
  `/api/kb/data` validati con zod; richieste di generazioni non ancora disponibili non ripetute per qualche secondo.
- Accessibilità: schede della Knowledge Base come link con `aria-current`, celle modificabili da tastiera,
  pulsanti con `aria-pressed`/`aria-expanded`, focus gestito in pannello del documento e menu mobile, animazioni
  ridotte rispettate.
- Valutazione: id inesistenti in `--only` e `--rescore` segnalati; rimosso un controllo inutilizzato.
- Node 24 richiesto anche in `engines`; nuove variabili del server di sviluppo in `.env.example`.

## [3f4d1d6] - 2026-11-26 - Includi `backend/src/storage/db.js`

### Corretto
- La regola `storage/` di `.gitignore` escludeva anche `backend/src/storage/db.js`: ora le cartelle di dati sono
  ancorate alla radice (`/storage/`, `/chroma_data/`) e il file è nel repository.

## [c034b4d] - 2026-11-26 - Segnaposto di caricamento per le conversazioni salvate

### Corretto
- Aprendo una conversazione salvata compariva per un attimo la schermata di benvenuto: ora c'è un segnaposto
  di caricamento.

## [c0a3e01] - 2026-11-26 - Banner del brand, scrollbar, responsive e messaggio per modello non disponibile

### Modificato
- Schermata iniziale con il banner del brand (`docs/brand/Banner-Hero*.png`, variante per il tema scuro), in
  WebP a due risoluzioni; domande suggerite allineate tra le colonne anche quando un testo va a capo.
- Scrollbar sottili nei colori del brand, con lo spazio sempre riservato: il layout non si sposta più quando un
  contenuto inizia a scorrere.
- Interfaccia verificata su 19 formati, da 320 px a 2560 px, compresi telefoni in orizzontale, tablet e
  schermi pieghevoli. Su mobile la chiave API e la ricerca nei dati vanno a capo invece di essere tagliate; sugli
  schermi bassi intestazione e campo di scrittura si compattano.
- Messaggio di errore specifico quando OpenRouter non ha provider disponibili per il modello scelto.

### Corretto
- La schermata iniziale si apriva già scorsa in fondo, con il banner tagliato.

## [e22efaa] - 2026-11-26 - Identità visiva: design system "Modernismo italiano"

### Modificato
- Nuova identità visiva dell'interfaccia, direzione "Modernismo italiano" (`docs/brand/`):
  - simbolo e logotipo originali, anche nella favicon;
  - barra laterale oltremare su pagine avorio, con accenti vermiglio, ocra e oliva e angoli quasi squadrati;
  - titoli in Figtree e testi in Inter, inclusi nel build;
  - illustrazione modernista nella schermata iniziale, con un'icona per ogni gruppo di domande;
  - contrasto WCAG AA verificato per ogni coppia testo/sfondo, in chiaro e in scuro.
- Grafici del data agent nella palette del brand, verificata per la distinguibilità con deficit nella visione
  dei colori.

## [56911b7] - 2026-11-26 - Modello effettivo sotto ogni risposta

### Aggiunto
- Modello effettivo sotto ogni risposta: modello, provider e costo delle chiamate di orchestratore e analista
  dati, letti dall'endpoint `/generation` di OpenRouter tramite i loro id. Se OpenRouter ha risposto con un
  modello di riserva compare l'avviso "Modello di riserva al posto di …". Nuova API `GET /api/generations`; il
  data agent restituisce gli id delle sue chiamate (`generazioni`); l'evento `final` porta `generations` e
  `requestedModel`, salvati anche nella cronologia.
- Valutazione: controllo "modello effettivo", che fa fallire un caso servito da un modello diverso da quello
  scelto.

## [b36242f] - 2026-11-25 - Confronto tra modelli e temperatura solo dove supportata

### Corretto
- I modelli più recenti di Anthropic e OpenAI (es. Claude Haiku 5.5, GPT-6 Luna) non funzionavano: non accettano il
  parametro `temperature` e, con `provider.require_parameters`, OpenRouter rifiutava la richiesta (404). Con il
  modello di riserva attivo l'app passava in silenzio a quello. Ora back end e data agent inviano `temperature: 0`
  solo ai modelli che la supportano secondo il catalogo OpenRouter, e la omettono se il catalogo non risponde.
- Valutazione: un turno finito in errore non conta più come percorso corretto.

### Aggiunto
- Confronto tra modelli nella valutazione (DeepSeek V4.1 Flash, Claude Haiku 5.5, GPT-6 Luna), eseguito senza
  modello di riserva.

## [d341ffb] - 2026-11-25 - Valutazione dell'orchestrazione, scadenza del turno e Docker

### Aggiunto
- Valutazione dell'orchestrazione (`eval/`): 20 casi in 5 categorie (documentazione, dati, regola applicata ai
  dati, conversazione e fuori ambito, domande di seguito) con percorso degli strumenti atteso, citazioni, testo e
  numeri dal ground truth; report Markdown e JSON con tempi e costo.
- Scadenza del turno propagata fino al data agent (`timeout_s`): un turno non supera più il tempo della chat
  anche quando l'orchestratore chiama l'analista più volte.
- Il data agent segnala le analisi interrotte (`completa: false`) e l'orchestratore non le ripete.
- Docker: Dockerfile per back end, data agent e front end (nginx), `compose.yaml` con indicizzazione one-shot,
  volumi per i dati e container non privilegiati in sola lettura.
- `TRUST_PROXY`: numero di proxy fidati davanti al back end (rate limit e log con il vero IP del client).

### Modificato
- L'orchestratore indica sempre il codice delle campagne quando le elenca e non aggiunge ipotesi non verificate.
- L'analista lavora per blocchi di codice completi, non ricontrolla la qualità dei dati già puliti e dichiara
  non verificabili le regole che richiedono informazioni assenti dal dataset invece di dedurle.

### Corretto
- Timeout della chat sulle domande di make-good: l'analista passava il tempo a dedurre dalle date le campagne
  "sospese su richiesta del cliente", informazione che il dataset non contiene, e l'orchestratore ripeteva
  l'analisi interrotta.

## [5682f8e] - 2026-11-25 - Ragionamento nel suo pannello e documentazione di progetto

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

[Non rilasciato]: https://github.com/giuvul/wayfare-media-agents/compare/3f4d1d6...HEAD
[3f4d1d6]: https://github.com/giuvul/wayfare-media-agents/commit/3f4d1d6
[c034b4d]: https://github.com/giuvul/wayfare-media-agents/commit/c034b4d
[c0a3e01]: https://github.com/giuvul/wayfare-media-agents/commit/c0a3e01
[e22efaa]: https://github.com/giuvul/wayfare-media-agents/commit/e22efaa
[56911b7]: https://github.com/giuvul/wayfare-media-agents/commit/56911b7
[b36242f]: https://github.com/giuvul/wayfare-media-agents/commit/b36242f
[d341ffb]: https://github.com/giuvul/wayfare-media-agents/commit/d341ffb
[5682f8e]: https://github.com/giuvul/wayfare-media-agents/commit/5682f8e
[ac52964]: https://github.com/giuvul/wayfare-media-agents/commit/ac52964
[1a3f038]: https://github.com/giuvul/wayfare-media-agents/commit/1a3f038
[d9482d9]: https://github.com/giuvul/wayfare-media-agents/commit/d9482d9
[4f0b7da]: https://github.com/giuvul/wayfare-media-agents/commit/4f0b7da
[9d95230]: https://github.com/giuvul/wayfare-media-agents/commit/9d95230
[6134c75]: https://github.com/giuvul/wayfare-media-agents/commit/6134c75
[ec575a1]: https://github.com/giuvul/wayfare-media-agents/commit/ec575a1
