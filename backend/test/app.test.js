import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pino from "pino";

import { createApp } from "../src/app.js";
import { createConversationStore, openDatabase } from "../src/storage/db.js";

const config = { FRONTEND_ORIGIN: ["http://localhost:5173"], CHAT_TIMEOUT_MS: 5000, CHAT_RATE_LIMIT_PER_MIN: 100, LLM_MODEL: "test" };

function makeDeps(agent) {
  const deleted = [];
  return {
    config,
    log: pino({ level: "silent" }),
    getAgent: () => agent,
    checkpointer: { getTuple: async () => undefined, deleteThread: async (id) => deleted.push(id) },
    conversations: createConversationStore(openDatabase(":memory:")),
    settings: { get: () => ({ model: "test" }), dataAgentOverride: () => ({}) },
    dataAgent: {
      health: async () => ({ status: "ready" }),
      chart: async () => new Response("png", { status: 200 }),
      deleteChart: async (id) => deleted.push(id),
    },
    retriever: { status: async () => ({ chunks: 40 }) },
    documents: {},
    indexer: {},
    deleted,
  };
}

const failingAgent = { stream: async () => { throw new Error("429 Rate limit exceeded"); } };

async function withServer(deps, fn) {
  const server = createApp(deps).listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}
const post = (base, body, accept = "application/json") =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Accept: accept }, body: JSON.stringify(body) });

test("valida l'input", () => withServer(makeDeps(failingAgent), async (base) => {
  assert.equal((await post(base, { message: "", sessionId: randomUUID() })).status, 400);
  assert.equal((await post(base, { message: "ciao", sessionId: "non-uuid" })).status, 400);
  assert.equal((await post(base, { message: "x".repeat(2001), sessionId: randomUUID() })).status, 400);
}));

test("gli errori del provider diventano un messaggio in italiano, salvato anche nella cronologia", () => {
  const deps = makeDeps(failingAgent);
  return withServer(deps, async (base) => {
    const sessionId = randomUUID();
    const res = await post(base, { message: "ciao", sessionId });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.match(body.error, /sovraccarico/);
    assert.doesNotMatch(body.error, /429|openrouter/i);
    const saved = deps.conversations.messages(sessionId);
    assert.deepEqual(saved.map((m) => [m.role, m.status ?? null]), [["user", null], ["assistant", "error"]]);
  });
});

test("in streaming l'errore arriva come evento SSE", () => withServer(makeDeps(failingAgent), async (base) => {
  const text = await (await post(base, { message: "ciao", sessionId: randomUUID() }, "text/event-stream")).text();
  assert.match(text, /event: status/);
  assert.match(text, /event: error\ndata: .*sovraccarico/);
}));

test("cronologia: elenco, dettaglio ed eliminazione con memoria e grafici", () => {
  const deps = makeDeps(failingAgent);
  return withServer(deps, async (base) => {
    const id = randomUUID();
    deps.conversations.ensure(id, "Domanda");
    deps.conversations.addMessage(id, { id: randomUUID(), role: "assistant", text: "r", steps: [{ artifact: { charts: ["c".repeat(32)] } }] });
    const list = await (await fetch(`${base}/api/conversations`)).json();
    assert.equal(list.conversations[0].title, "Domanda");
    assert.equal((await (await fetch(`${base}/api/conversations/${id}`)).json()).messages.length, 1);
    assert.equal((await fetch(`${base}/api/conversations/${id}`, { method: "DELETE" })).status, 204);
    assert.deepEqual(deps.deleted, [id, "c".repeat(32)]);
    assert.equal((await fetch(`${base}/api/conversations/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/conversations/non-uuid`)).status, 400);
  });
});

test("proxy grafici: rifiuta id non validi", () => withServer(makeDeps(failingAgent), async (base) => {
  assert.equal((await fetch(`${base}/api/charts/..%2F..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${base}/api/charts/${"b".repeat(32)}`)).headers.get("content-type"), "image/png");
}));

test("health aggregato con il modello delle impostazioni", () => withServer(makeDeps(failingAgent), async (base) => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.equal(body.status, "ok");
  assert.equal(body.model, "test");
}));
