# Architettura e decisioni

Questo documento descrive come è fatto il sistema e perché. Per installazione, test e sicurezza in breve vedi il
[README](../README.md); per la storia delle modifiche il [CHANGELOG](../CHANGELOG.md).

## 1. Componenti

Tre servizi applicativi più un vector store, ciascuno con una responsabilità sola. Gli indirizzi tra servizi
arrivano da variabili d'ambiente, quindi ogni componente può girare sulla stessa macchina, in container
separati o su host diversi senza modifiche al codice.

| Servizio | Responsabilità | Non fa |
|---|---|---|
| Front end (`frontend/`) | Presentazione: chat in streaming, Knowledge Base, Impostazioni | Nessuna logica di dominio, nessun segreto |
| Back end (`backend/`) | Orchestrazione (sceglie lo strumento), RAG, persistenza, impostazioni, unico punto d'accesso per il browser | Non esegue codice generato dall'LLM |
| Data agent (`data_agent/`) | Tutto ciò che tocca il dataset: qualità, pulizia, analisi, grafici | Non è raggiungibile dal browser |
| ChromaDB | Vettori e metadati dei passaggi della documentazione | Non calcola gli embedding (li calcola il back end) |

## 2. Il percorso di una domanda

```mermaid
sequenceDiagram
  participant U as Front end
  participant B as Back end (orchestratore)
  participant L as LLM (OpenRouter)
  participant R as Retriever + Chroma
  participant D as Data agent
  U->>B: POST /api/chat (SSE)
  B->>L: domanda + cronologia + strumenti
  L-->>B: chiamata cerca_documentazione {motivo, query}
  B-->>U: tool_start (il motivo va nel pannello del ragionamento)
  B->>R: embedding della query, top-k, soglia
  R-->>B: passaggi con sezione e documento
  B-->>U: tool_end (fonti)
  L-->>B: chiamata analizza_dati {motivo, task con la regola per esteso}
  B->>D: POST /analyze (token interno, timeout)
  D-->>B: sintesi, grafici, tabella, codice, report di pulizia
  B-->>U: tool_end (analisi)
  L-->>B: risposta finale con citazioni [§x.y]
  B-->>U: token... poi final
  B->>B: salva domanda, risposta e passaggi (SQLite)
```

### Orchestratore (`backend/src/agent.js`)

- Agente ReAct con `createAgent` di LangChain.js v1 e due strumenti: `cerca_documentazione` e `analizza_dati`.
  È il modello a decidere quale usare, guidato da regole esplicite nel prompt di sistema: regole → documentazione,
  numeri → analista, regola applicata ai dati → prima la regola con le sue **esclusioni**, poi l'analisi con la
  regola scritta per esteso. Il compito per l'analista deve essere autosufficiente, perché l'analista non ha
  memoria della conversazione.
- Gli strumenti restituiscono `content_and_artifact`: il testo va al modello, i dati strutturati (fonti,
  grafici, tabelle) vanno all'interfaccia senza passare dal modello.
- Middleware: limite di chiamate al modello per turno (niente loop), retry sugli errori transitori del provider,
  context editing (nelle conversazioni lunghe i vecchi output degli strumenti vengono sostituiti da un segnaposto).
- Memoria per conversazione con un checkpointer SQLite (`thread_id` = id della conversazione).
- **Ragionamento visibile**: ogni strumento ha un parametro `motivo`, una frase per l'utente. Il ragionamento
  viaggia quindi con la chiamata allo strumento e l'interfaccia lo colloca subito nel pannello del ragionamento.
  Come rete di sicurezza, il testo libero del modello viene trattenuto fino a 160 caratteri: se nel frattempo
  arriva una chiamata a uno strumento era un ragionamento e non compare mai come inizio della risposta.

Eventi SSE verso il front end: `status`, `tool_start`, `tool_end`, `token`, `final`, `error`.

**Modello effettivo** (`backend/src/generations.js`). Con i modelli di riserva attivi (`LLM_FALLBACK_MODELS`)
OpenRouter può rispondere con un modello diverso da quello scelto, e la risposta in streaming non lo segnala in
modo affidabile. Ogni chiamata al modello ha però un id di generazione (`gen-...`): il turno raccoglie quelli
dell'orchestratore (id dei messaggi del modello) e quelli dell'analista (restituiti dal data agent in
`generazioni`) e li manda nell'evento `final`, insieme al modello scelto (`requestedModel`). Il front end li
passa a `GET /api/generations`, che interroga l'endpoint gratuito `/generation` di OpenRouter con la chiave del
server e restituisce modello, provider e costo. I dati compaiono su OpenRouter qualche secondo dopo la risposta
(prima: 404), quindi il front end riprova ogni 4 s per circa un minuto; la risposta non aspetta questo controllo.

## 3. Documentazione e RAG (`backend/src/rag/`, `backend/src/embeddings/`)

**Indicizzazione.** La fonte canonica è il Markdown in `data/kb/` (modificabile dall'interfaccia); i PDF sono
comunque supportati. Il documento viene diviso nelle sue sezioni seguendo i titoli (numerazione esplicita, come
`## 4.3 Cancellazione`, o automatica), poi in passaggi da 900 caratteri con sovrapposizione di 150 che non
attraversano mai il confine di una sezione. Ogni passaggio porta un'intestazione di contesto
("Handbook › 4.3 Cancellazione") che entra anche nell'embedding, e nei metadati documento, sezione e titolo.
L'indicizzazione è idempotente: un documento invariato (stesso SHA-256) non viene ricalcolato. Le scritture
passano da una coda, una alla volta.

**Ricerca.** Embedding della domanda, top-k (5) per similarità coseno, scarto dei passaggi sotto la soglia di
pertinenza. Il modello riceve i passaggi con l'indicazione di come citarli (`[§4.3]`); l'interfaccia trasforma
le citazioni in pulsanti che aprono il documento sulla sezione.

**Modelli di embedding.** Scelti dall'interfaccia: un modello del catalogo OpenRouter, oppure un modello locale
eseguito con Transformers.js su CPU (E5 Small, E5 Base, BGE-M3), così documenti e domande non escono dal server
per indicizzazione e ricerca.

- Ogni modello ha la sua collection: vettori di modelli diversi non sono confrontabili.
- Il cambio è un'operazione in background (download, caricamento, indicizzazione, verifica) e il nuovo modello
  diventa attivo solo se riesce; altrimenti resta il precedente.
- **Soglia calibrata per modello.** Ogni modello ha una scala di similarità diversa (misurato: E5 restituisce
  valori tra 0,7 e 0,9 per qualsiasi testo, Nemotron tra 0 e 0,6). Al cambio il sistema pone 8 domande
  chiaramente fuori tema e fissa la soglia al 75° percentile delle loro similarità migliori.
- Per i modelli locali il sistema valuta la macchina (CPU, RAM disponibile, disco, piattaforma, limiti del
  container) contro requisiti misurati, e scarica i file in streaming con revisione fissata e SHA-256 verificato.

## 4. Data agent (`data_agent/`)

### Preparazione del dataset

```mermaid
flowchart TD
  A[CSV grezzo + dizionario dati] --> Q[Analisi della qualità<br/>deterministica, tutte le righe]
  Q --> C{Dati e dizionario<br/>invariati?}
  C -- sì --> K[Cache]
  C -- solo i dati --> R[Riesegue il codice già validato]
  C -- no --> G[L'LLM scrive pulisci&#40;df&#41;<br/>da dizionario + analisi]
  R --> V{Controlli superati?}
  G --> S[Esecuzione in sandbox] --> V
  V -- sì --> OK[Dataset pulito in cache<br/>scrittura atomica]
  V -- no, codice riusato --> G
  V -- no, codice nuovo --> E[Errori all'LLM, nuovo tentativo<br/>max 3]
  E --> S
```

1. **Analisi della qualità** (`quality.py`, nessuna AI). Tipi, valori canonici, sinonimi e intervalli plausibili
   vengono letti dal dizionario dati. Ogni anomalia è riportata con numero di righe, esempi (`id_riga` e valore)
   e valore canonico proposto. Sul dataset sintetico ritrova esattamente le 13 anomalie iniettate dal
   generatore (verificato da un test sul ground truth).
2. **Codice di pulizia scritto dall'LLM**, a partire da dizionario e analisi, eseguito nella sandbox.
3. **Doppia verifica.** Controlli di business (`validate`: numero di righe, righe non valide, tipi, plausibilità
   dei CPM...) e la stessa analisi della qualità rieseguita sui dati puliti: le anomalie "bloccanti" devono
   essere zero, anche se presenti in una sola riga. In caso contrario gli errori tornano all'LLM.
4. **Riuso.** Se cambiano solo i dati, si riesegue il codice già validato senza chiamare l'LLM; se non supera più
   i controlli (es. un tipo di anomalia nuovo) si rigenera. Durante l'aggiornamento le analisi continuano sui
   dati precedenti.

### Analisi

Agente ReAct (`create_agent` di LangChain 1.x) con un interprete Python sul DataFrame pulito. Riproduce il
pattern del pandas agent di `langchain-experimental`, pacchetto dismesso a maggio 2026. Se finiscono i passi o
il tempo, un'ultima chiamata senza strumenti produce la risposta con i risultati già ottenuti, invece di perdere
il lavoro. I grafici sono salvati automaticamente come PNG; l'ultima tabella prodotta diventa la vista "Dati".

### Sandbox (`sandbox.py`)

Difesa a più livelli:

- **policy statica sull'AST**: import da una lista chiusa (anche `from ... import`), niente funzioni di lettura o
  scrittura di file, rete, memoria mappata o estensioni C, nessun nome o metodo speciale (`__...__`), nessuna
  stringa che punti a URL o percorsi di sistema;
- **processo figlio** avviato con `spawn`: non eredita la memoria del server. Chiave OpenRouter e token interno
  vengono tolti dall'ambiente del server all'avvio (`scrub_secret_env`), quindi il figlio non li trova nemmeno in
  `/proc/self/environ`;
- **limiti del sistema operativo** applicati al figlio dopo il caricamento dei dati: CPU, memoria (3 GB) e
  dimensione dei file scritti (20 MB); output testuale e numero di grafici (4) limitati;
- **canale di ritorno in JSON**: il server non deserializza oggetti arbitrari dal figlio. Gli unici pickle
  (DataFrame del dataset e risultati della pulizia) passano da un unpickler ristretto (`safe_pickle.py`) che
  ammette solo le classi di pandas e NumPy necessarie;
- timeout per esecuzione, mai oltre il tempo rimasto all'analisi; esecuzioni serializzate (alcuni modelli chiamano
  più strumenti in parallelo).

La policy è difesa in profondità; il confine di sicurezza è il processo.

## 5. Persistenza

| Dato | Dove | Note |
|---|---|---|
| Conversazioni, messaggi, impostazioni | `storage/app.db` (SQLite, WAL) | Permessi `0600`: può contenere la chiave impostata dall'interfaccia |
| Memoria dell'agente | `storage/checkpoints.db` | Checkpointer LangGraph, permessi `0600` |
| Modelli di embedding locali | `storage/models/` | Scaricati dall'interfaccia |
| Vettori | ChromaDB | Una collection per modello di embedding |
| Dataset pulito, codice e report | `data_agent/cache/` | Rigenerabile; scritture atomiche |
| Grafici | `data_agent/charts/` | Eliminati con la conversazione |

## 6. Tempi: catena dei timeout e scadenza del turno

Ogni livello aspetta più a lungo di quello che chiama, così l'errore nasce dove avviene il problema e
risale con un messaggio comprensibile:

front end 150 s > chat nel back end 120 s > chiamata al data agent 75 s > analisi 60 s (+ risposta finale
forzata) > singola esecuzione nella sandbox 15 s.

I limiti fissi non bastano quando un turno chiama l'analista più volte: due analisi da 60 s superano i 120 s
della chat e il lavoro va perso. Per questo la **scadenza del turno viene propagata** (deadline propagation):

1. la chat fissa la scadenza del turno e la passa all'agente (`configurable.deadline`);
2. lo strumento `analizza_dati` concede all'analista il tempo che resta, meno 20 s di riserva per la risposta
   finale dell'orchestratore e 15 s di margine per la chiusura dell'analisi, e al massimo 60 s; se restano meno di 20 s non avvia l'analisi e chiede al modello
   di rispondere con i risultati già ottenuti;
3. il data agent riceve il budget (`timeout_s`) e smette di esplorare con una riserva (15 s, al massimo un quarto
   del budget) per concludere il passo in corso e scrivere la risposta con i risultati parziali;
4. un'analisi interrotta torna con `completa: false` e l'orchestratore riceve l'indicazione di non ripeterla.

Un turno quindi termina sempre entro la sua scadenza, con una risposta completa o con risultati parziali
dichiarati come tali. I tentativi verso il modello sono gestiti da un solo livello (`modelRetryMiddleware`
dell'agente, il client HTTP non ritenta), così i tempi restano prevedibili.

Se un turno viene interrotto (Stop, scadenza, riavvio del server) mentre uno strumento lavora, la memoria
dell'agente resta con una chiamata senza risultato, che i provider rifiutano. Il turno successivo la chiude con
un risultato d'errore prima della nuova domanda (`unansweredToolCalls` in `agent.js`).

### Errori

Il back end distingue due casi. Gli errori 4xx mostrano solo messaggi scritti per l'utente (`HttpError` e le
classi che la estendono, o i dettagli in italiano del data agent), mai i testi interni delle librerie; gli errori
5xx vengono registrati nel log e tradotti da `userFacingError` in un messaggio generico. Gli strumenti
dell'agente non lanciano eccezioni: restituiscono un risultato `ERRORE: ...` che il modello spiega all'utente,
con `ok: false` nell'artefatto per l'interfaccia.

## 7. Deployment

`compose.yaml` avvia cinque servizi: `chroma`, `data-agent`, `ingest` (indicizza la documentazione e termina),
`backend` e `frontend` (nginx con la build statica, che inoltra `/api` al back end senza buffering per lo
streaming). L'ordine è garantito dalle dipendenze: Chroma pronto → indicizzazione completata → back end pronto →
front end.

- Solo il front end è pubblicato, su `127.0.0.1`; gli altri servizi sono raggiungibili solo sulla rete interna.
- Utenti non privilegiati, filesystem in sola lettura, nessuna capability, `no-new-privileges`. Si scrive solo
  nei volumi: `storage` (SQLite e modelli locali), `kb`, `dataset`, `analysis-cache`, `charts`, `chroma`.
  Eccezione: l'immagine ufficiale di Chroma gira come root con filesystem scrivibile; ha comunque nessuna
  capability e `no-new-privileges`, e non è raggiungibile dall'esterno.
- nginx aggiunge alle pagine statiche le intestazioni di sicurezza (`Content-Security-Policy` con
  `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`); le risposte `/api` hanno quelle di helmet.
  I volumi di documentazione e dataset vengono popolati dall'immagine al primo avvio, poi le modifiche fatte
  dall'interfaccia sopravvivono a rebuild e aggiornamenti.
- Immagini Debian (glibc) per back end e data agent, perché il runtime ONNX degli embedding locali non supporta
  musl; i binari ONNX per macOS e Windows vengono rimossi dall'immagine.
- Le variabili che dipendono dal container (indirizzi, porte, percorsi) sono fissate nel compose e prevalgono sul
  `.env`, che contiene solo chiave, modelli e token.
- `TRUST_PROXY=1`: dietro nginx il back end legge l'IP del client da `X-Forwarded-For` per il rate limit.

## 8. Decisioni

| Decisione | Motivazione |
|---|---|
| LLM via OpenRouter, API compatibile OpenAI | Vendor-agnostic: modello e provider si cambiano da configurazione o dall'interfaccia. Modelli economici in sviluppo, modelli migliori in produzione |
| Orchestratore in Node.js, analista in Python | Requisito del progetto, ed è la divisione naturale: I/O e streaming in Node, analisi dati nell'ecosistema pandas |
| `createAgent` di LangChain v1 con middleware | Pattern ReAct standard con limiti, retry e gestione del contesto dichiarativi, invece di un ciclo scritto a mano |
| Strumenti con `content_and_artifact` | Il modello riceve solo il testo che gli serve; grafici e tabelle arrivano all'interfaccia senza consumare token |
| Ragionamento come parametro `motivo` degli strumenti | Il testo libero del modello non si distingue dalla risposta finché non arriva la chiamata allo strumento: con un parametro dedicato il ragionamento è riconoscibile subito |
| Pulizia scritta dall'LLM ma verificata deterministicamente | L'AI generalizza a dati nuovi; i controlli garantiscono che il risultato sia corretto e ripetibile (stessi dati, stessi numeri) |
| Analisi della qualità guidata dal dizionario | Le regole stanno in un solo posto, modificabile da chi conosce il business; l'analisi non dipende da ciò che l'LLM nota |
| Markdown come fonte della documentazione | Modificabile dall'interfaccia, versionabile, sezioni precise per le citazioni; il PDF è un'esportazione |
| Una collection per modello di embedding | Cambiare modello non distrugge l'indice precedente: il cambio è reversibile e il ritorno è quasi istantaneo |
| Embedding locali con Transformers.js nel back end | Nessun servizio aggiuntivo; ONNX quantizzato su CPU; catalogo curato perché ogni famiglia richiede pooling e prefissi propri |
| SQLite per cronologia e impostazioni | Persistenza server-side senza un database da gestire; adatto a un uso interno |
| Design system come token CSS, font inclusi nel build | Un solo foglio di stile con variabili per tema chiaro e scuro (palette in `docs/brand/`); font OFL dai pacchetti `@fontsource-variable`, così l'app non dipende da servizi esterni |
| SSE consumato con `fetch` | `EventSource` non supporta POST; `fetch` permette corpo JSON, interruzione e timeout |
| Grafici PNG (matplotlib/seaborn) | Requisito del progetto; la vista "Dati" affianca la tabella con i numeri |
| JavaScript, non TypeScript | Scelta del progetto; i confini sono tipizzati a runtime con zod (back end) e pydantic (data agent) |
| Scadenza del turno propagata agli strumenti | I timeout fissi per livello non impediscono a più chiamate in sequenza di superare il tempo del turno; con la scadenza ogni livello sa quanto tempo gli resta |
| Temperatura 0 solo dove il modello la accetta | Rende ripetibili numeri e codice dell'analista; i modelli più recenti di Anthropic e OpenAI non la accettano e, con `require_parameters`, OpenRouter rifiuterebbe la richiesta. Il supporto si legge dal catalogo OpenRouter |
| Modello effettivo letto da OpenRouter dopo la risposta | Il modello che ha risposto si conosce con certezza solo dall'endpoint `/generation`; interrogarlo dopo la risposta non rallenta la chat, e la chiave resta sul server |
| Valutazione end-to-end separata dai test | I test unitari usano un modello finto e sono gratuiti e deterministici; la qualità dell'orchestrazione si misura solo con il modello vero, su casi con risultato atteso |

## 9. Limiti noti

- Nessuna autenticazione degli utenti: uso locale o su rete interna.
- Il processo della sandbox gira con lo stesso utente del data agent e ne condivide la rete: la policy blocca
  file e rete dal codice generato, ma non è un isolamento a livello di sistema (che richiederebbe un container per
  esecuzione o seccomp). In Docker il filesystem è comunque in sola lettura fuori dai volumi.
- Il modello effettivo si legge con la chiave attuale: per le risposte generate con una chiave poi sostituita,
  o dal data agent con una chiave diversa da quella del back end, l'indicatore resta "non disponibile".
- Con i modelli economici le domande che applicano regole articolate ai dati (es. make-good con esclusioni) a
  volte non si concludono nel tempo disponibile: la risposta lo dichiara e riporta i risultati parziali, senza
  inventare numeri (vedi la [valutazione](../eval/README.md)).
- I modelli di embedding locali sono un po' meno precisi di Nemotron sul primo risultato, ma recuperano quasi
  sempre la sezione giusta tra i primi passaggi passati all'agente.
- Con un modello di embedding locale i passaggi recuperati fanno comunque parte del prompt inviato al modello
  linguistico su OpenRouter: non esce la documentazione intera, ma quei passaggi sì.
