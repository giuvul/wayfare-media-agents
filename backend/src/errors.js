// Messaggi di errore per l'utente: in italiano, senza dettagli interni (stack, URL, chiavi).
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

/** Gestore di errori per le route asincrone di Express. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
