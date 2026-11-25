import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pino from "pino";

import { createApp } from "../src/app.js";

const config = { FRONTEND_ORIGIN: ["http://localhost:5173"], CHAT_TIMEOUT_MS: 5000, CHAT_RATE_LIMIT_PER_MIN: 100, LLM_MODEL: "test" };
const deps = {
  config,
  log: pino({ level: "silent" }),
  agent: { stream: async () => { throw new Error("429 Rate limit exceeded"); } },
  checkpointer: null,
  dataAgent: { health: async () => ({ status: "ready" }), chart: async () => new Response("png", { status: 200 }) },
  retriever: { status: async () => ({ chunks: 40 }) },
};

async function withServer(fn) {
  const server = createApp(deps).listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}
const post = (base, body, accept = "application/json") =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Accept: accept }, body: JSON.stringify(body) });

test("valida l'input", () => withServer(async (base) => {
  assert.equal((await post(base, { message: "", sessionId: randomUUID() })).status, 400);
  assert.equal((await post(base, { message: "ciao", sessionId: "non-uuid" })).status, 400);
  assert.equal((await post(base, { message: "x".repeat(2001), sessionId: randomUUID() })).status, 400);
}));

test("gli errori del provider diventano un messaggio in italiano, senza dettagli interni", () => withServer(async (base) => {
  const res = await post(base, { message: "ciao", sessionId: randomUUID() });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /sovraccarico/);
  assert.doesNotMatch(body.error, /429|openrouter/i);
}));

test("in streaming l'errore arriva come evento SSE", () => withServer(async (base) => {
  const text = await (await post(base, { message: "ciao", sessionId: randomUUID() }, "text/event-stream")).text();
  assert.match(text, /event: status/);
  assert.match(text, /event: error\ndata: .*sovraccarico/);
}));

test("proxy grafici: rifiuta id non validi", () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/api/charts/..%2F..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${base}/api/charts/${"b".repeat(32)}`)).headers.get("content-type"), "image/png");
}));

test("health aggregato", () => withServer(async (base) => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.equal(body.status, "ok");
}));
