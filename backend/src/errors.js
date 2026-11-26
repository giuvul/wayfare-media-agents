// Messaggi di errore per l'utente: in italiano, senza dettagli interni (stack, URL, chiavi).

/** Errore con un messaggio pensato per l'utente e uno stato HTTP (4xx): l'API lo restituisce così com'è. */
export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Messaggio per un errore 4xx: solo testi scritti da noi (HttpError o dettagli del data agent), mai quelli delle librerie. */
export function clientErrorMessage(err) {
  if (err instanceof HttpError) return err.message;
  if (err.type === "entity.too.large") return "Richiesta troppo grande.";
  if (err.type === "entity.parse.failed") return "Il corpo della richiesta non è un JSON valido.";
  if (typeof err.detail === "string") return err.detail; // HTTPException del data agent, già in italiano
  return "Richiesta non valida.";
}

export function userFacingError(err) {
  if (err.name === "AbortError" || err.name === "TimeoutError") return "La richiesta ha impiegato troppo tempo. Riprova o semplifica la domanda.";
  if (/\b401\b|unauthori[sz]ed|invalid api key|no auth/i.test(err.message)) return "La chiave API di OpenRouter non è valida: controllala nelle Impostazioni.";
  if (/\b402\b|insufficient credits|payment required/i.test(err.message)) return "Credito OpenRouter esaurito: ricarica l'account o cambia chiave nelle Impostazioni.";
  if (/429|rate.?limit/i.test(err.message)) return "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo.";
  // OpenRouter: nessun provider disponibile per il modello scelto con i parametri richiesti
  if (/no endpoints found|model.*(not found|does not exist)/i.test(err.message)) {
    return "Il modello scelto non è disponibile su OpenRouter in questo momento: riprova o scegline un altro nelle Impostazioni.";
  }
  return "Si è verificato un errore durante l'elaborazione. Riprova tra poco.";
}
