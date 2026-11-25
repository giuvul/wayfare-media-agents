// Temperatura inviata solo ai modelli che la accettano (con require_parameters OpenRouter rifiuterebbe la richiesta).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createChatModel } from "../src/llm.js";
import { createSettingsService } from "../src/settings.js";

const config = {
  LLM_MODEL: "deepseek/deepseek-v4.1-flash", OPENROUTER_API_KEY: "sk-test", OPENROUTER_BASE_URL: "https://openrouter.test/api/v1",
  LLM_FALLBACK_MODELS: [], LLM_TIMEOUT_MS: 1000,
};

test("senza temperatura il modello non la invia", () => {
  // il corpo della richiesta è il JSON dei parametri: un valore undefined non viene serializzato
  const body = JSON.parse(JSON.stringify(createChatModel(config, { model: "anthropic/claude-haiku-5.5" }).invocationParams()));
  assert.equal("temperature" in body, false);
  assert.deepEqual(body.provider, { require_parameters: true });
});

test("con temperatura 0 la invia", () => {
  assert.equal(createChatModel(config, { temperature: 0 }).invocationParams().temperature, 0);
});

const memoryStore = () => {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) };
};
const catalog = {
  data: [
    { id: "deepseek/deepseek-v4.1-flash", supported_parameters: ["tools", "temperature"] },
    { id: "anthropic/claude-haiku-5.5", supported_parameters: ["tools", "reasoning"] },
  ],
};

test("il supporto alla temperatura viene letto dal catalogo OpenRouter", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(catalog), { status: 200 });
  const settings = createSettingsService({ config, store: memoryStore(), fetchImpl });
  assert.equal(await settings.supportsTemperature("deepseek/deepseek-v4.1-flash"), true);
  assert.equal(await settings.supportsTemperature("anthropic/claude-haiku-5.5"), false);
  assert.equal(await settings.supportsTemperature("modello/sconosciuto"), false);
});

test("senza catalogo la temperatura viene omessa", async () => {
  const fetchImpl = async () => new Response("errore", { status: 503 });
  const settings = createSettingsService({ config, store: memoryStore(), fetchImpl });
  assert.equal(await settings.supportsTemperature("deepseek/deepseek-v4.1-flash"), false);
});
