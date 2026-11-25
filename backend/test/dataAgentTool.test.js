// Strumento analizza_dati: scadenza del turno propagata al data agent e analisi parziali.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createDataAgentClient, createDataAgentTool, FINAL_ANSWER_RESERVE_MS, formatAnalysis } from "../src/tools/dataAgent.js";

const config = { DATA_AGENT_URL: "http://data-agent.test", DATA_AGENT_TOKEN: "x".repeat(16), DATA_AGENT_TIMEOUT_MS: 75_000 };
const OK = { answer: "177 campagne.", code: [], charts: [], table: null, cleaning: {}, steps: 1, duration_ms: 10, error: null, completa: true };

function fakeDataAgent(response = OK) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { requests, client: createDataAgentClient(config, fetchImpl) };
}

const invoke = (tool, deadline) =>
  tool.invoke(
    { type: "tool_call", id: "c1", name: "analizza_dati", args: { task: "Conta le campagne distinte." } },
    { configurable: { deadline } },
  );

test("il data agent riceve il tempo che resta al turno, meno la riserva per la risposta finale", async () => {
  const { requests, client } = fakeDataAgent();
  await invoke(createDataAgentTool(client), Date.now() + 50_000 + FINAL_ANSWER_RESERVE_MS);
  const { timeout_s: timeout } = requests[0].body;
  assert.ok(timeout >= 48 && timeout <= 50, `timeout_s=${timeout}`);
});

test("il budget dell'analisi non supera i 60 secondi anche con molto tempo a disposizione", async () => {
  const { requests, client } = fakeDataAgent();
  await invoke(createDataAgentTool(client), Date.now() + 600_000);
  assert.equal(requests[0].body.timeout_s, 60);
});

test("con il turno quasi scaduto l'analisi non parte e il modello viene avvisato", async () => {
  const { requests, client } = fakeDataAgent();
  const msg = await invoke(createDataAgentTool(client), Date.now() + FINAL_ANSWER_RESERVE_MS + 5_000);
  assert.equal(requests.length, 0);
  assert.match(msg.content, /^ERRORE: tempo del turno quasi esaurito/);
  assert.equal(msg.artifact.error, "tempo del turno quasi esaurito");
});

test("senza scadenza (uso diretto) l'analisi usa i limiti del data agent", async () => {
  const { requests, client } = fakeDataAgent();
  await invoke(createDataAgentTool(client), undefined);
  assert.equal(requests[0].body.timeout_s, undefined);
});

test("un'analisi interrotta chiede al modello di non ripeterla", () => {
  assert.match(formatAnalysis({ ...OK, completa: false }), /NON ripeterla/);
  assert.doesNotMatch(formatAnalysis(OK), /ripeterla/);
});
