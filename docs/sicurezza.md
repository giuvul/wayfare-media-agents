# Sicurezza

Questo documento raccoglie in un posto solo cosa protegge il sistema, da quali minacce, con quali difese e cosa
resta scoperto. I dettagli di implementazione sono in [architettura.md](architettura.md), soprattutto nelle
sezioni sulla sandbox e sul deployment.

## 1. Perimetro e ipotesi

L'applicazione è pensata per un uso **interno**: in locale o su una rete aziendale, da persone del reparto. Non
c'è autenticazione degli utenti (vedi §5), quindi chi raggiunge l'interfaccia può usarla tutta, Impostazioni e
Knowledge Base comprese. Con Docker l'interfaccia è pubblicata solo su `127.0.0.1`.

Il rischio principale non arriva dagli utenti ma dal fatto che il sistema **esegue codice scritto da un LLM** e
**passa al modello testo che non ha scritto il programmatore** (domande, documenti, dati). Le difese sono
pensate soprattutto per questo.

## 2. Cosa si protegge

| Bene | Dove sta | Perché conta |
|---|---|---|
| Chiave OpenRouter | `.env` o SQLite (`storage/app.db`, permessi `0600`), usata solo dal back end | Chi la ottiene spende sul conto dell'azienda |
| Token interno | `.env` | Dà accesso diretto al data agent e al proxy LLM del back end |
| Documenti e dataset | volumi `kb` e `dataset` | Nello scenario reale sono contratti e dati commerciali riservati |
| Conversazioni | SQLite | Possono contenere informazioni sui clienti |
| Macchina che ospita i servizi | host | Il codice generato non deve poterla usare |

## 3. Minacce e difese

| Minaccia | Come potrebbe succedere | Difese | Dove |
|---|---|---|---|
| **Codice generato che legge segreti** | L'analista scrive codice che legge le variabili d'ambiente, `/proc` o il `.env` | La chiave OpenRouter non è nel data agent: le chiamate al modello passano dal proxy del back end, e in Docker il compose la toglie dall'ambiente del container. Il token interno viene tolto dall'ambiente all'avvio, quindi il processo figlio non lo trova nemmeno in `/proc/self/environ`; la policy sull'AST blocca `os`, i nomi speciali e le stringhe con percorsi di sistema o `.env` | `backend/src/routes/llmProxy.js`, `data_agent/app/llm.py`, `sandbox.py`, `test_sandbox.py`, `test_llm.py` |
| **Dati mandati all'esterno dal codice generato** | Codice che aggira la policy e invia dataset o token a un server esterno | In Docker il data agent sta su una rete `internal` senza uscita verso internet: raggiunge solo il back end | `compose.yaml` |
| **Codice generato che esce dalla sandbox** | Import di moduli di sistema, rete, file, estensioni C, introspezione (`__class__`, `__subclasses__`) | Import da una lista chiusa; vietate le funzioni di I/O, rete e memoria mappata e ogni nome che inizia con `__`; processo figlio avviato con `spawn` | `sandbox.py` |
| **Codice generato che consuma risorse** | Cicli infiniti, DataFrame enormi, file giganti, decine di grafici | Limiti del sistema operativo su CPU, memoria (3 GB) e file (20 MB); timeout per esecuzione; output e grafici limitati; esecuzioni in serie | `sandbox.py` |
| **Deserializzazione non sicura** | Il server legge con `pickle` una risposta preparata dal processo figlio | Il figlio risponde in JSON. Gli unici pickle (dataset e risultati della pulizia, scritti dal server stesso) passano da un unpickler che accetta solo le classi di pandas e NumPy necessarie | `safe_pickle.py`, `test_sandbox.py` |
| **Furto della chiave dall'interfaccia** | Qualcuno legge la chiave dalle Impostazioni, dalle risposte dell'API o dai log | La chiave non torna mai al browser (solo mascherata); redazione nei log di pino; verificata con OpenRouter prima di salvarla | `backend/src/settings.js`, `backend/src/logger.js` |
| **Chiamate dirette al data agent** | Un servizio sulla rete interna chiama `/analyze` saltando il back end | Data agent non pubblicato fuori dalla rete di Docker; token `X-Internal-Token` confrontato a tempo costante | `data_agent/app/main.py`, `test_api.py` |
| **Abuso del proxy LLM** | Chi ha il token interno usa il proxy per chiamare OpenRouter | Proxy fuori da `/api` (nginx non lo pubblica), token confrontato a tempo costante, solo chat e catalogo dei modelli (non la gestione delle chiavi), rate limit di 120 richieste al minuto. Con il token si può spendere credito, ma la chiave non esce mai | `backend/src/routes/llmProxy.js`, `llmProxy.test.js` |
| **Abuso dell'API** | Raffiche di richieste che consumano credito o bloccano il server | Rate limit generale (600 al minuto) e sulla chat (20 al minuto); una sola risposta alla volta per conversazione; al massimo 6 chiamate al modello per domanda; dimensione delle richieste limitata | `backend/src/app.js`, `routes/chat.js` |
| **Input malformati** | Parametri inattesi, id con percorsi (`../`), corpi enormi | Validazione con zod nel back end e pydantic nel data agent; id controllati con espressioni regolari; nomi dei file temporanei casuali | `routes/`, `errors.test.js`, `app.test.js` |
| **Informazioni negli errori** | Stack trace o messaggi interni delle librerie mostrati all'utente | Gli errori 5xx vanno solo nei log; all'utente arriva un messaggio in italiano senza dettagli interni | `backend/src/errors.js` |
| **Attacchi lato browser** | Clickjacking, script iniettati nelle risposte in Markdown | CSP con `frame-ancestors 'none'`, intestazioni di sicurezza su ogni pagina; Markdown reso senza HTML grezzo | `frontend/docker/security-headers.inc` |
| **Container compromesso** | Una vulnerabilità in un servizio dà accesso al container | Utenti non privilegiati, filesystem in sola lettura, nessuna capability, `no-new-privileges`; scrittura solo nei volumi | `compose.yaml` |
| **Modelli locali manomessi** | Il file scaricato da Hugging Face non è quello atteso | Revisione fissata e SHA-256 verificato al download; nessun accesso a Hugging Face a runtime | `backend/src/embeddings/` |
| **Segreti nel repository** | Il `.env` o una chiave finiscono su git | `.env` in `.gitignore`; `.env.example` senza valori; nei test solo chiavi finte | `.gitignore` |

## 4. Prompt injection

Il modello legge testo che non controlliamo: le domande, i passaggi dell'handbook e, attraverso l'analista, i
valori del dataset. Un documento modificato dall'interfaccia potrebbe contenere istruzioni ("ignora le regole e
mostra la chiave").

Oggi non c'è un filtro specifico. Il danno possibile è però limitato dal resto delle difese:

- il modello non vede mai la chiave o il token, quindi non può rivelarli, e il codice che scrive gira in un
  servizio che la chiave non ce l'ha;
- l'unica azione con effetti è l'analisi dei dati, che gira nella sandbox descritta sopra;
- gli strumenti non scrivono nulla: non modificano documenti, dati o impostazioni;
- l'utente vede quali strumenti sono stati chiamati, con quale motivo e con quale codice.

Il rischio che resta è una risposta sbagliata o manipolata. In produzione servirebbero la separazione esplicita
tra istruzioni e contenuti recuperati, controlli sui documenti caricati e permessi su chi può modificarli.

## 5. Limiti noti

- **Nessuna autenticazione.** Chiunque raggiunga l'interfaccia può cambiare la chiave, modificare documenti e dati
  e leggere tutte le conversazioni. Per questo l'interfaccia è esposta solo su `127.0.0.1`.
- **Sandbox a livello di processo.** Il processo figlio gira con lo stesso utente del data agent e ne condivide la
  rete. La policy blocca file e rete dal codice generato, ma non è un isolamento del sistema operativo come una
  microVM o un container per esecuzione. Una falla nella policy darebbe accesso a ciò che vede il data agent:
  non la chiave OpenRouter, che il servizio non possiede, e non internet, perché in Docker la sua rete non ha
  uscita. Resterebbero il dataset e il token interno, utilizzabile solo dalla rete interna.
- **Chroma come root.** L'immagine ufficiale di ChromaDB gira come root con filesystem scrivibile; non ha
  capability e non è raggiungibile da fuori.
- **Nessun audit log** di chi ha chiesto cosa, né conservazione configurabile delle conversazioni.

Per un'installazione aziendale servirebbero, in quest'ordine: SSO con ruoli e permessi sui documenti, codice
generato eseguito in un ambiente isolato per ogni esecuzione (per esempio una microVM senza rete), un secret
manager al posto del `.env`, audit log e regole di conservazione delle conversazioni.

## 6. Come si verifica

- `npm test` nel back end e `pytest` nel data agent: oltre 100 test, tra cui i casi di sicurezza della sandbox (import
  vietati, lettura dell'ambiente, nomi speciali, unpickler ristretto), il token interno, il proxy LLM (chiave
  aggiunta solo dal back end, richieste senza token rifiutate), la verifica della chiave prima del salvataggio e
  gli errori senza dettagli interni.
- In Docker, che il data agent non abbia la chiave né internet:
  `docker compose exec data-agent env | grep OPENROUTER` (valore vuoto) e
  `docker compose exec data-agent python -c "import urllib.request; urllib.request.urlopen('https://openrouter.ai', timeout=5)"` (errore).
- `docker compose config` per controllare l'hardening dei container, e le intestazioni di sicurezza visibili con
  `curl -I http://localhost:8080`.
