// Messaggi di errore per l'utente: chiari sulla causa, senza dettagli interni.
import assert from "node:assert/strict";
import { test } from "node:test";

import { userFacingError } from "../src/errors.js";

const msg = (text) => userFacingError(new Error(text));

test("ogni causa nota ha il suo messaggio", () => {
  assert.match(msg("401 Unauthorized"), /chiave API/);
  assert.match(msg("402 Insufficient credits"), /Credito OpenRouter esaurito/);
  assert.match(msg("429 Rate limit exceeded"), /sovraccarico/);
  assert.match(msg("404 No endpoints found that can handle the requested parameters."), /modello scelto non è disponibile/);
  assert.match(msg("qualcosa di inatteso"), /Si è verificato un errore/);
});
