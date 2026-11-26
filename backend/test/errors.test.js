// Messaggi di errore per l'utente: chiari sulla causa, senza dettagli interni.
import assert from "node:assert/strict";
import { test } from "node:test";

import { clientErrorMessage, HttpError, userFacingError } from "../src/errors.js";

const msg = (text) => userFacingError(new Error(text));

test("ogni causa nota ha il suo messaggio", () => {
  assert.match(msg("401 Unauthorized"), /chiave API/);
  assert.match(msg("402 Insufficient credits"), /Credito OpenRouter esaurito/);
  assert.match(msg("429 Rate limit exceeded"), /sovraccarico/);
  assert.match(msg("404 No endpoints found that can handle the requested parameters."), /modello scelto non è disponibile/);
  assert.match(msg("qualcosa di inatteso"), /Si è verificato un errore/);
});

test("errori 4xx: solo messaggi scritti da noi, mai quelli delle librerie", () => {
  assert.equal(clientErrorMessage(new HttpError("Nome di documento non valido.")), "Nome di documento non valido.");
  assert.equal(clientErrorMessage(Object.assign(new Error("Unexpected token } in JSON"), { status: 400, type: "entity.parse.failed" })), "Il corpo della richiesta non è un JSON valido.");
  assert.equal(clientErrorMessage(Object.assign(new Error("data agent HTTP 404: Riga non trovata."), { status: 404, detail: "Riga non trovata." })), "Riga non trovata.");
  assert.equal(clientErrorMessage(Object.assign(new Error("internal detail"), { status: 400 })), "Richiesta non valida.");
});
