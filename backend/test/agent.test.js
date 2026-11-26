import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ToolMessage } from "@langchain/core/messages";
import { test } from "node:test";

import { createOrchestrator, EMPTY_ANSWER, runTurn } from "../src/agent.js";
import { createDataAgentTool } from "../src/tools/dataAgent.js";
import { createKnowledgeBaseTool } from "../src/tools/knowledgeBase.js";
import { ScriptedChatModel } from "./fakeModel.js";

const retriever = {
  search: async () => [{ section: "4.3", sectionTitle: "Cancellazioni", page: 5, similarity: 0.64, text: "Doc › 4.3\nDa 7 a 14 giorni: 50%." }],
};
const dataClient = {
  analyze: async (task) => ({ answer: `Analisi: ${task}`, charts: [{ id: "a".repeat(32) }], table: { columns: [], rows: [] }, steps: [], duration_ms: 10 }),
};
const tools = [createKnowledgeBaseTool(retriever), createDataAgentTool(dataClient)];
const call = (id, name, args, content = "") => ({ content, tool_calls: [{ id, name, args, type: "tool_call" }] });

test("un turno RAG produce un solo step con le fonti come artifact", async () => {
  const model = new ScriptedChatModel([call("c1", "cerca_documentazione", { query: "penali cancellazione" }, "Cerco la regola."), "Penale del 50% [§4.3, p. 5]."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const events = [];
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "penali?", onEvent: (e) => events.push(e) });
  assert.equal(res.answer, "Penale del 50% [§4.3, p. 5].");
  assert.equal(res.steps.length, 1);
  assert.equal(res.steps[0].artifact.sources[0].section, "4.3");
  assert.equal(res.steps[0].thought, "Cerco la regola."); // il ragionamento visibile resta nello step
  assert.deepEqual(events.filter((e) => e !== "token"), ["tool_start", "tool_end", "final"]);
});

test("il ragionamento non compare mai tra i token della risposta", async () => {
  const model = new ScriptedChatModel([
    call("c1", "cerca_documentazione", { query: "penali cancellazione" }, "Cerco nell'handbook la regola sulle cancellazioni."),
    "Penale del 50% [§4.3].",
  ]);
  model.streaming = true;
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const events = [];
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "penali?", onEvent: (e, d) => events.push([e, d]) });
  const tokens = events.filter(([e]) => e === "token").map(([, d]) => d.text).join("");
  assert.equal(tokens, "Penale del 50% [§4.3].");
  assert.equal(res.steps[0].thought, "Cerco nell'handbook la regola sulle cancellazioni.");
  assert.ok(events.findIndex(([e]) => e === "tool_start") < events.findIndex(([e]) => e === "token"));
});

test("il motivo passato allo strumento diventa il ragionamento dello step", async () => {
  const model = new ScriptedChatModel([
    call("c1", "analizza_dati", { motivo: "Calcolo il CPM effettivo per formato.", task: "CPM effettivo per formato" }),
    "Il CPM più alto è quello del Lounge Screen.",
  ]);
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "cpm?" });
  assert.equal(res.steps[0].thought, "Calcolo il CPM effettivo per formato.");
});

test("una risposta lunga viene inoltrata in streaming, non tutta alla fine", async () => {
  const long = "La penale dipende dai giorni di preavviso. ".repeat(10);
  const model = new ScriptedChatModel([long]);
  model.streaming = true;
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const events = [];
  await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "penali?", onEvent: (e, d) => events.push([e, d]) });
  const tokens = events.filter(([e]) => e === "token");
  assert.ok(tokens.length > 10);
  assert.equal(tokens.map(([, d]) => d.text).join(""), long);
});

test("il secondo turno della stessa sessione non ripete gli step del primo", async () => {
  const model = new ScriptedChatModel([
    call("c1", "cerca_documentazione", { query: "penali" }), "Risposta 1",
    call("c2", "analizza_dati", { task: "impression mensili FCO 2026" }), "Risposta 2",
  ]);
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const sessionId = randomUUID();
  await runTurn({ agent, checkpointer, sessionId, message: "uno" });
  const second = await runTurn({ agent, checkpointer, sessionId, message: "due" });
  assert.deepEqual(second.steps.map((s) => s.tool), ["analizza_dati"]);
  assert.equal(second.steps[0].artifact.charts.length, 1);
  assert.equal(second.answer, "Risposta 2");
});

test("small talk: nessuno strumento", async () => {
  const model = new ScriptedChatModel(["Ciao! Posso aiutarti con regole e dati delle campagne."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const events = [];
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "ciao", onEvent: (e) => events.push(e) });
  assert.equal(res.steps.length, 0);
  assert.equal(res.answer, "Ciao! Posso aiutarti con regole e dati delle campagne.");
  assert.ok(!events.includes("tool_start"));
});

test("errore del data agent: lo step risulta fallito ma il turno si chiude", async () => {
  const notReady = Object.assign(new Error("data agent HTTP 503: Dataset non pronto (stato: cleaning)."), { status: 503, detail: "Dataset non pronto (stato: cleaning)." });
  const failing = createDataAgentTool({ analyze: async () => { throw notReady; } });
  const model = new ScriptedChatModel([call("c1", "analizza_dati", { task: "spesa totale per formato" }), "L'analisi non è disponibile."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools: [tools[0], failing], maxModelCalls: 6 });
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "spesa?" });
  assert.equal(res.steps[0].ok, false);
  assert.equal(res.steps[0].artifact.error, "Dataset non pronto (stato: cleaning)."); // il dettaglio, non "HTTP 503"
});

test("il turno raccoglie gli id delle generazioni di orchestratore e analista, solo del turno corrente", async () => {
  const analyst = createDataAgentTool({ analyze: async () => ({ answer: "177 campagne.", charts: [], steps: 1, duration_ms: 5, generazioni: ["gen-analista-1"] }) });
  const model = new ScriptedChatModel(["Ciao!", call("c1", "analizza_dati", { task: "conta le campagne" }), "Sono 177."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools: [tools[0], analyst], maxModelCalls: 6 });
  const sessionId = randomUUID();
  await runTurn({ agent, checkpointer, sessionId, message: "ciao" });
  const events = [];
  const res = await runTurn({ agent, checkpointer, sessionId, message: "quante campagne?", onEvent: (e, d) => events.push([e, d]) });
  assert.deepEqual(res.generations, { orchestratore: ["gen-scripted-2", "gen-scripted-3"], analista: ["gen-analista-1"] });
  assert.deepEqual(events.find(([e]) => e === "final")[1].generations, res.generations);
});

test("un turno interrotto durante uno strumento non blocca la conversazione", async () => {
  const slow = createDataAgentTool({
    analyze: (_task, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  });
  const model = new ScriptedChatModel([call("c1", "analizza_dati", { task: "spesa totale per formato" }), "Eccomi."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools: [tools[0], slow], maxModelCalls: 6 });
  const sessionId = randomUUID();
  const stop = new AbortController();
  const first = runTurn({ agent, checkpointer, sessionId, message: "spesa?", signal: stop.signal, onEvent: (e) => e === "tool_start" && stop.abort() });
  await assert.rejects(first);
  // la memoria contiene la chiamata allo strumento senza risultato: il turno successivo la chiude prima della domanda
  const res = await runTurn({ agent, checkpointer, sessionId, message: "ci sei?" });
  assert.equal(res.answer, "Eccomi.");
  const history = model.received.at(-1);
  const closed = history.findIndex((m) => ToolMessage.isInstance(m) && m.tool_call_id === "c1");
  assert.ok(closed > 0 && closed < history.findIndex((m) => m.content === "ci sei?"));
});

test("un turno senza testo finale ha comunque una risposta", async () => {
  const model = new ScriptedChatModel([call("c1", "cerca_documentazione", { query: "penali cancellazione" }), "  "]);
  const { agent, checkpointer } = createOrchestrator({ model, tools, maxModelCalls: 6 });
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "penali?" });
  assert.equal(res.answer, EMPTY_ANSWER);
});

test("documentazione non raggiungibile: step fallito, il modello lo sa", async () => {
  const kbDown = createKnowledgeBaseTool({ search: async () => { throw new Error("ECONNREFUSED chroma:8000"); } });
  const model = new ScriptedChatModel([call("c1", "cerca_documentazione", { query: "penali cancellazione" }), "Non posso consultarla ora."]);
  const { agent, checkpointer } = createOrchestrator({ model, tools: [kbDown, tools[1]], maxModelCalls: 6 });
  const res = await runTurn({ agent, checkpointer, sessionId: randomUUID(), message: "penali?" });
  assert.equal(res.steps[0].ok, false);
  assert.doesNotMatch(JSON.stringify(res.steps[0].artifact), /ECONNREFUSED|chroma/); // nessun dettaglio interno
});
