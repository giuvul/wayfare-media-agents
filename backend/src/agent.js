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
- ${KB_TOOL_NAME}: l'handbook aziendale (regole, policy, condizioni, procedure, definizioni, metodologia).
- ${DATA_TOOL_NAME}: un analista dati che lavora sul dataset delle campagne (gen 2025 - set 2026) e produce numeri e grafici.

Come decidere:
1. Domande su regole, condizioni, procedure o definizioni -> ${KB_TOOL_NAME}.
2. Domande che chiedono numeri, andamenti, classifiche o grafici sulle campagne -> ${DATA_TOOL_NAME}.
3. Domande che applicano una regola ai dati (es. make-good, sconti fuori policy, rispetto delle condizioni):
   PRIMA ${KB_TOOL_NAME} per recuperare la regola esatta, POI ${DATA_TOOL_NAME} con la regola scritta per esteso nel compito.
4. Saluti e conversazione: rispondi senza strumenti, presentando brevemente cosa sai fare.
5. Richieste estranee al lavoro del reparto (meteo, attualità, programmazione...): spiega con garbo che non rientrano
   nel tuo ambito, senza usare strumenti.

Regole:
- Per ${DATA_TOOL_NAME} scrivi un compito autonomo e completo: risolvi i riferimenti alla conversazione
  (es. "e per Malpensa?" diventa la richiesta precedente ripetuta per l'aeroporto MXP) e indica metrica, filtri e periodo.
- Non calcolare mai numeri da solo: riporta quelli restituiti da ${DATA_TOOL_NAME}.
- Basa le risposte sulle regole aziendali SOLO su ciò che restituisce ${KB_TOOL_NAME} e cita le fonti come [§4.3, p. 5].
  Se la documentazione non contiene la risposta, dillo chiaramente: non usare conoscenze generiche.
- Grafici, tabelle e codice dell'analisi sono già mostrati all'utente sotto la tua risposta: non ripeterli e non inserire link.
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
 * Esegue un turno di conversazione ed emette eventi per l'interfaccia:
 *  tool_start {id, tool, args} · tool_end {id, tool, ok, durationMs, artifact} · token {text} · final {answer, steps}
 */
export async function runTurn({ agent, checkpointer, sessionId, message, signal, onEvent = () => {} }) {
  const steps = [];
  const started = new Map();
  let answer = "";
  // Gli aggiornamenti dei middleware possono riproporre l'intera cronologia: si considerano solo i messaggi
  // nuovi di questo turno, ciascuno una volta sola.
  const previous = await checkpointer?.getTuple({ configurable: { thread_id: sessionId } });
  const seen = new Set((previous?.checkpoint?.channel_values?.messages ?? []).map((m) => m.id).filter(Boolean));

  const stream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    { configurable: { thread_id: sessionId }, streamMode: ["updates", "messages"], signal },
  );

  for await (const [mode, data] of stream) {
    if (mode === "messages") {
      const [chunk] = data;
      if (AIMessageChunk.isInstance(chunk) && !chunk.tool_call_chunks?.length && typeof chunk.content === "string" && chunk.content) {
        onEvent("token", { text: chunk.content });
      }
      continue;
    }
    for (const update of Object.values(data ?? {})) {
      for (const msg of update?.messages ?? []) {
        if (msg.id) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);
        }
        if (AIMessage.isInstance(msg) && msg.tool_calls?.length) {
          for (const call of msg.tool_calls) {
            started.set(call.id, Date.now());
            const step = { id: call.id, tool: call.name, args: call.args };
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
          answer = typeof msg.content === "string" ? msg.content : msg.content.map((p) => p.text ?? "").join("");
        }
      }
    }
  }
  const result = { answer: answer.trim(), steps };
  onEvent("final", result);
  return result;
}
