// L'orchestratore: un agente ReAct (LangChain.js createAgent) che decide da solo quale strumento usare.
import {
  ClearToolUsesEdit,
  contextEditingMiddleware,
  createAgent,
  modelCallLimitMiddleware,
  modelRetryMiddleware,
} from "langchain";
import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { DATA_TOOL_NAME } from "./tools/dataAgent.js";
import { KB_TOOL_NAME } from "./tools/knowledgeBase.js";

export const SYSTEM_PROMPT = `Sei l'assistente AI del reparto Media Sales & Campaign Performance di Wayfare Media,
concessionaria pubblicitaria digitale di otto aeroporti italiani (FCO, MXP, LIN, BGY, VCE, NAP, BLQ, CTA).
Aiuti account manager e responsabili commerciali. Rispondi sempre in italiano, in modo chiaro e professionale.

Hai due strumenti e decidi tu quale usare:
- ${KB_TOOL_NAME}: la documentazione aziendale (handbook: regole, policy, condizioni, procedure, definizioni, metodologia).
- ${DATA_TOOL_NAME}: un analista dati che lavora sul dataset delle campagne (gen 2025 - set 2026) e produce numeri e grafici.

Come decidere:
1. Domande su regole, condizioni, procedure o definizioni -> ${KB_TOOL_NAME}.
2. Domande che chiedono numeri, andamenti, classifiche o grafici sulle campagne -> ${DATA_TOOL_NAME}.
3. Domande che applicano una regola ai dati (es. make-good, sconti fuori policy, rispetto delle condizioni):
   PRIMA ${KB_TOOL_NAME} per recuperare la regola esatta con condizioni ed ESCLUSIONI (cerca anche le esclusioni se
   non compaiono nei passaggi), POI ${DATA_TOOL_NAME} con la regola scritta per esteso nel compito: formula, soglie,
   perimetro e ogni esclusione, ciascuna tradotta in un filtro sui dati.
4. Saluti e conversazione: rispondi senza strumenti, presentando brevemente cosa sai fare.
5. Richieste estranee al lavoro del reparto (meteo, attualità, programmazione...): spiega con garbo che non rientrano
   nel tuo ambito, senza usare strumenti.

Regole:
- Per ${DATA_TOOL_NAME} scrivi un compito autonomo e completo: risolvi i riferimenti alla conversazione
  (es. "e per Malpensa?" diventa la richiesta precedente ripetuta per l'aeroporto MXP) e indica metrica, filtri e periodo.
  L'analista non ricorda le richieste precedenti: ogni compito deve contenere tutto ciò che serve.
- Non calcolare mai numeri da solo: riporta quelli restituiti da ${DATA_TOOL_NAME}.
- Basa le risposte sulle regole aziendali SOLO su ciò che restituisce ${KB_TOOL_NAME} e cita le sezioni usate
  subito dopo l'affermazione, nel formato [§4.3] (più sezioni: [§5.2; §5.3]).
  Se la documentazione non contiene la risposta, dillo chiaramente: non usare conoscenze generiche.
- Grafici, tabelle e codice dell'analisi sono già mostrati all'utente sotto la tua risposta: non ripeterli e non inserire link.
- Quando usi uno strumento, spiega in una frase breve cosa stai per fare nel suo parametro \`motivo\`: l'utente la vede
  come ragionamento. Non scrivere testo prima di chiamare uno strumento: il testo libero è solo la risposta finale.
- Quando elenchi campagne indica sempre il loro codice (es. WM-2025-0079), che identifica il contratto, insieme
  all'inserzionista. Riporta solo ciò che l'analisi ha verificato, senza ipotesi sulle cause.
- Risposte concise: prima la risposta diretta, poi il contesto utile. Usa elenchi solo se aiutano.`;

/**
 * @param {{ model: import("@langchain/openai").ChatOpenAI, tools: any[], maxModelCalls: number, checkpointer?: any }} deps
 */
export function createOrchestrator({ model, tools, maxModelCalls, checkpointer = new MemorySaver() }) {
  const agent = createAgent({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    checkpointer, // memoria della conversazione per sessione (thread_id)
    middleware: [
      modelCallLimitMiddleware({ runLimit: maxModelCalls, exitBehavior: "end" }), // niente loop infiniti
      // errori transitori del provider (429/5xx); se persistono l'errore risale all'API, che risponde in italiano
      modelRetryMiddleware({ maxRetries: 2, initialDelayMs: 1500, onFailure: "error" }),
      contextEditingMiddleware({
        // nelle conversazioni lunghe i vecchi output dei tool vengono sostituiti da un segnaposto
        edits: [new ClearToolUsesEdit({ trigger: { tokens: 8000 }, keep: { messages: 4 } })],
      }),
    ],
  });
  return { agent, checkpointer };
}

/**
 * Restituisce l'agente per le impostazioni correnti (modello e chiave scelti dall'utente).
 * L'agente viene ricreato solo quando le impostazioni cambiano; la memoria (checkpointer) è condivisa.
 */
export function createAgentProvider({ settings, buildModel, tools, maxModelCalls, checkpointer }) {
  let cached = { version: -1, agent: null };
  return async () => {
    if (cached.version !== settings.version) {
      const version = settings.version;
      const { model, apiKey } = settings.get();
      // temperatura 0 (risposte ripetibili) solo dove il modello la accetta
      const temperature = (await settings.supportsTemperature(model)) ? 0 : undefined;
      cached = { version, agent: createOrchestrator({ model: buildModel({ model, apiKey, temperature }), tools, maxModelCalls, checkpointer }).agent };
    }
    return cached.agent;
  };
}

const textOf = (msg) =>
  (typeof msg.content === "string" ? msg.content : msg.content.map((p) => p.text ?? "").join("")).trim();

// Testo trattenuto prima di inoltrarlo come risposta: se nel frattempo arriva una chiamata a uno strumento,
// era un ragionamento e finisce nello step invece che nella risposta. Una frase di ragionamento sta sotto questa soglia.
export const HOLD_CHARS = 160;

/**
 * Esegue un turno di conversazione ed emette eventi per l'interfaccia:
 *  tool_start {id, tool, args, thought} · tool_end {id, tool, ok, durationMs, artifact} · token {text} · final {answer, steps}
 * `thought` è il ragionamento visibile: il parametro `motivo` dello strumento o, in mancanza, il testo che il
 * modello ha scritto prima della chiamata. I token emessi appartengono sempre alla risposta.
 */
export async function runTurn({ agent, checkpointer, sessionId, message, signal, deadline, onEvent = () => {} }) {
  const steps = [];
  const started = new Map();
  let answer = "";
  // Gli aggiornamenti dei middleware possono riproporre l'intera cronologia: si considerano solo i messaggi
  // nuovi di questo turno, ciascuno una volta sola.
  const previous = await checkpointer?.getTuple({ configurable: { thread_id: sessionId } });
  const seen = new Set((previous?.checkpoint?.channel_values?.messages ?? []).map((m) => m.id).filter(Boolean));

  // testo della chiamata al modello in corso: trattenuto finché non è chiaro se è risposta o ragionamento
  let pending = { text: "", released: false, toolCall: false };
  const resetPending = () => {
    pending = { text: "", released: false, toolCall: false };
  };

  const stream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    // deadline (ms epoch): scadenza del turno, letta dagli strumenti per non avviare lavoro che non finirebbe in tempo
    { configurable: { thread_id: sessionId, deadline }, streamMode: ["updates", "messages"], signal },
  );

  for await (const [mode, data] of stream) {
    if (mode === "messages") {
      const [chunk] = data;
      if (!AIMessageChunk.isInstance(chunk)) continue;
      if (chunk.tool_call_chunks?.length) {
        pending.toolCall = true; // il testo trattenuto era un ragionamento: non diventa risposta
        pending.text = "";
        continue;
      }
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (!text || pending.toolCall) continue;
      if (pending.released) onEvent("token", { text });
      else {
        pending.text += text;
        if (pending.text.length >= HOLD_CHARS) {
          pending.released = true;
          onEvent("token", { text: pending.text });
        }
      }
      continue;
    }
    // fine di una chiamata al modello (o di uno strumento): una risposta breve trattenuta viene inoltrata
    if (!pending.toolCall && !pending.released && pending.text) onEvent("token", { text: pending.text });
    resetPending();
    for (const update of Object.values(data ?? {})) {
      for (const msg of update?.messages ?? []) {
        if (msg.id) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);
        }
        if (AIMessage.isInstance(msg) && msg.tool_calls?.length) {
          const thought = textOf(msg);
          for (const [k, call] of msg.tool_calls.entries()) {
            started.set(call.id, Date.now());
            const reason = typeof call.args?.motivo === "string" ? call.args.motivo.trim() : "";
            const step = { id: call.id, tool: call.name, args: call.args, thought: reason || (k === 0 && thought ? thought : null) };
            steps.push(step);
            onEvent("tool_start", step);
          }
        } else if (ToolMessage.isInstance(msg)) {
          const step = steps.find((s) => s.id === msg.tool_call_id) ?? { id: msg.tool_call_id, tool: msg.name };
          Object.assign(step, {
            ok: !String(msg.content).startsWith("ERRORE"),
            durationMs: Date.now() - (started.get(msg.tool_call_id) ?? Date.now()),
            artifact: msg.artifact ?? null,
          });
          onEvent("tool_end", step);
        } else if (AIMessage.isInstance(msg) && !msg.tool_calls?.length) {
          answer = textOf(msg);
        }
      }
    }
  }
  const result = { answer: answer.trim(), steps };
  onEvent("final", result);
  return result;
}
