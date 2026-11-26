// Modello effettivo: lettura dell'endpoint /generation di OpenRouter e API per l'interfaccia.
import assert from "node:assert/strict";
import { test } from "node:test";
import pino from "pino";

import { createApp } from "../src/app.js";
import { createGenerationService, sameModel } from "../src/generations.js";

const config = { OPENROUTER_BASE_URL: "https://openrouter.test/api/v1" };
const settings = { get: () => ({ apiKey: "sk-test" }) };
const DATA = { model: "anthropic/claude-haiku-5.5-20261015", provider_name: "Anthropic", total_cost: 0.0012 };

function fakeOpenRouter({ readyAfter = 0 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ id: url.searchParams.get("id"), auth: init.headers.Authorization });
    if (calls.length <= readyAfter) return new Response('{"error":{"code":404}}', { status: 404 });
    return new Response(JSON.stringify({ data: DATA }), { status: 200 });
  };
  return { calls, fetchImpl };
}

test("restituisce modello, provider e costo, con la chiave del server", async () => {
  const { calls, fetchImpl } = fakeOpenRouter();
  const service = createGenerationService({ config, settings, fetchImpl });
  const out = await service.lookup(["gen-1-a"]);
  assert.deepEqual(out["gen-1-a"], { model: DATA.model, provider: "Anthropic", costUsd: 0.0012 });
  assert.equal(calls[0].auth, "Bearer sk-test");
});

test("una generazione non ancora disponibile torna null e viene richiesta di nuovo; poi resta in cache", async () => {
  const { calls, fetchImpl } = fakeOpenRouter({ readyAfter: 1 });
  const service = createGenerationService({ config, settings, fetchImpl });
  assert.equal((await service.lookup(["gen-1-a"]))["gen-1-a"], null);
  assert.equal((await service.lookup(["gen-1-a"]))["gen-1-a"].model, DATA.model);
  await service.lookup(["gen-1-a"]);
  assert.equal(calls.length, 2);
});

test("un errore di rete non fa fallire la richiesta", async () => {
  const service = createGenerationService({ config, settings, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.deepEqual(await service.lookup(["gen-1-a"]), { "gen-1-a": null });
});

test("il modello servito coincide con quello scelto anche con il suffisso di versione", () => {
  assert.ok(sameModel("anthropic/claude-haiku-5.5-20261015", "anthropic/claude-haiku-5.5"));
  assert.ok(sameModel("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"));
  assert.ok(!sameModel("openai/gpt-oss-120b", "anthropic/claude-haiku-5.5"));
});

test("GET /api/generations valida gli id", async () => {
  const lookups = [];
  const generations = { lookup: async (ids) => (lookups.push(ids), Object.fromEntries(ids.map((id) => [id, null]))) };
  const server = createApp({
    config: { FRONTEND_ORIGIN: ["http://localhost:5173"], TRUST_PROXY: 0, CHAT_TIMEOUT_MS: 5000, CHAT_RATE_LIMIT_PER_MIN: 100 },
    log: pino({ level: "silent" }), generations, conversations: {}, settings: {}, dataAgent: {}, retriever: {}, documents: {}, indexer: {},
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/generations`;
  try {
    assert.equal((await fetch(`${base}?ids=`)).status, 400);
    assert.equal((await fetch(`${base}?ids=chatcmpl-1`)).status, 400);
    assert.equal((await fetch(`${base}?ids=${Array.from({ length: 31 }, (_, i) => `gen-${i}`).join(",")}`)).status, 400);
    const res = await fetch(`${base}?ids=gen-1-a,gen-1-a,gen-2-b`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { generations: { "gen-1-a": null, "gen-2-b": null } });
    assert.deepEqual(lookups, [["gen-1-a", "gen-2-b"]]);
  } finally {
    server.close();
  }
});
