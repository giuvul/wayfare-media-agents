// Parametro comune agli strumenti: il "perché" della chiamata, mostrato all'utente come ragionamento.
// Il ragionamento viaggia con la chiamata allo strumento invece che come testo libero del modello: così
// l'interfaccia lo colloca subito nel pannello del ragionamento e non lo confonde con l'inizio della risposta.
import { z } from "zod";

export const REASON_FIELD = z
  .string()
  .max(300)
  .optional()
  .describe("Una frase breve, rivolta all'utente, su cosa stai per fare e perché (es. 'Cerco nell'handbook le penali di cancellazione'). È mostrata come ragionamento.");
