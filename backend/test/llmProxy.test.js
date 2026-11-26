import assert from "node:assert/strict";
import { test } from "node:test";
import pino from "pino";

import { createApp } from "../src/app.js";
import { sameSecret } from "../src/routes/llmProxy.js";

const TOKEN = "token-interno-di-prova-0123456789";
const KEY = "sk-or-v1-chiave-vera-del-back-end";
const config = {
  FRONTEND_ORIGIN: ["http://localhost:5173"], TRUST_PROXY: 0, CHAT_TIMEOUT_MS: 5000, CHAT_RATE_LIMIT_PER_MIN: 100,
  LLM_MODEL: "test", DATA_AGENT_TOKEN: TOKEN, OPENROUTER_BASE_URL: "https://or.test/api/v1",
};

function makeDeps(upstream) {
  const calls = [];
  const llmFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return upstream(url, init);
  };
  return {
    calls,
    deps: {
      config, log: pino({ level: "silent" }), llmFetch,
      settings: { get: () => ({ model: "test", apiKey: KEY }), dataAgentOverride: () => ({}) },
      dataAgent: {}, retriever: {}, conversations: {}, documents: {}, indexer: {},
    },
  };
}

async function withServer(deps, fn) {
  const server = createApp(deps).listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}/internal/llm`);
  } finally {
    server.close();
  }
}

const completion = { id: "gen-123", choices: [{ message: { role: "assistant", content: "ok" } }] };
const ok = () => new Response(JSON.stringify(completion), { status: 200, headers: { "content-type": "application/json" } });
const post = (base, body, token = TOKEN) =>
  fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test("proxy LLM: inoltra a OpenRouter con la chiave del back end, mai con il token interno", async () => {
  const { deps, calls } = makeDeps(ok);
  await withServer(deps, async (base) => {
    const res = await post(base, { model: "vendor/model", messages: [{ role: "user", content: "ciao" }] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), completion); // id della generazione conservato
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://or.test/api/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(calls[0].init.body).model, "vendor/model");
  assert.doesNotMatch(calls[0].init.body, new RegExp(TOKEN));
});

test("proxy LLM: senza token valido nessuna chiamata a valle", async () => {
  const { deps, calls } = makeDeps(ok);
  await withServer(deps, async (base) => {
    const body = { model: "m", messages: [] };
    assert.equal((await post(base, body, null)).status, 401);
    assert.equal((await post(base, body, "token-sbagliato")).status, 401);
    assert.equal((await fetch(`${base}/models`)).status, 401);
    // solo chat/completions: gli altri endpoint di OpenRouter (es. gestione delle chiavi) non sono raggiungibili
    const other = await fetch(`${base}/keys`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(other.status, 404);
  });
  assert.equal(calls.length, 0);
});

test("proxy LLM: corpo non valido rifiutato, errori di OpenRouter inoltrati così come sono", async () => {
  const { deps } = makeDeps(() => new Response(JSON.stringify({ error: { message: "Insufficient credits", code: 402 } }), { status: 402 }));
  await withServer(deps, async (base) => {
    assert.equal((await post(base, { messages: [] })).status, 400);
    const res = await post(base, { model: "m", messages: [] });
    assert.equal(res.status, 402);
    assert.match((await res.json()).error.message, /credits/);
  });
});

test("proxy LLM: OpenRouter irraggiungibile -> 502 senza dettagli interni", async () => {
  const { deps } = makeDeps(() => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND or.test"); });
  await withServer(deps, async (base) => {
    const res = await post(base, { model: "m", messages: [] });
    assert.equal(res.status, 502);
    assert.doesNotMatch(await res.text(), /ENOTFOUND/);
  });
});

test("proxy LLM: health senza token, catalogo dei modelli con token e in cache", async () => {
  const { deps, calls } = makeDeps(() => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }));
  await withServer(deps, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      assert.deepEqual(await res.json(), { data: [{ id: "m" }] });
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers, undefined); // il catalogo è pubblico: la chiave non serve e non viene inviata
});

test("confronto del token a tempo costante, anche con lunghezze diverse", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abcd"), false);
});
