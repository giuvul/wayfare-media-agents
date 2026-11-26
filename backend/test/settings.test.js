import assert from "node:assert/strict";
import { test } from "node:test";

import { createSettingsService } from "../src/settings.js";
import { createSettingsStore, openDatabase } from "../src/storage/db.js";

const config = { OPENROUTER_API_KEY: "sk-or-v1-env", OPENROUTER_BASE_URL: "https://openrouter.test/api/v1", LLM_MODEL: "env/model", LLM_FALLBACK_MODELS: [] };
const fetchImpl = async (url) =>
  String(url).endsWith("/key")
    ? Response.json({ data: { usage: 0, limit: null } })
    : Response.json({ data: [{ id: "vendor/model-ok", name: "Ok", supported_parameters: ["tools"] }] });

test("chiave valida e modello inesistente: non cambia nulla, nemmeno la versione", async () => {
  const settings = createSettingsService({ config, store: createSettingsStore(openDatabase(":memory:")), fetchImpl });
  await assert.rejects(settings.update({ apiKey: "sk-or-v1-abcdefghijklmnopqrstuvwxyz", model: "vendor/inesistente" }), /Modello non trovato/);
  assert.equal(settings.get().apiKey, "sk-or-v1-env");
  assert.equal(settings.version, 0);
});

test("chiave e modello validi: salvati insieme, l'agente viene ricreato", async () => {
  const settings = createSettingsService({ config, store: createSettingsStore(openDatabase(":memory:")), fetchImpl });
  await settings.update({ apiKey: "sk-or-v1-abcdefghijklmnopqrstuvwxyz", model: "vendor/model-ok" });
  assert.deepEqual([settings.get().apiKeySource, settings.get().model, settings.version], ["ui", "vendor/model-ok", 1]);
});
