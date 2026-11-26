import assert from "node:assert/strict";
import { test } from "node:test";

import { generationIds, summarizeGenerations } from "../src/generations.js";

const generations = { orchestratore: ["gen-1", "gen-2"], analista: ["gen-3"] };
const haiku = (provider = "Anthropic") => ({ model: "anthropic/claude-haiku-5.5-20261015", provider, costUsd: 0.001 });

test("raccoglie gli id senza duplicati", () => {
  assert.deepEqual(generationIds({ orchestratore: ["gen-1"], analista: ["gen-1", "gen-2"] }), ["gen-1", "gen-2"]);
  assert.deepEqual(generationIds(undefined), []);
});

test("modello scelto: nome delle Impostazioni, provider e costo totale", () => {
  const s = summarizeGenerations(generations, { "gen-1": haiku(), "gen-2": haiku("Amazon Bedrock"), "gen-3": haiku() }, "anthropic/claude-haiku-5.5");
  assert.equal(s.pending, 0);
  assert.deepEqual(s.roles[0], { role: "orchestratore", models: [{ model: "anthropic/claude-haiku-5.5", providers: ["Anthropic", "Amazon Bedrock"], fallback: false }] });
  assert.ok(Math.abs(s.costUsd - 0.003) < 1e-9);
});

test("modello di riserva segnalato; generazioni non ancora disponibili contate", () => {
  const s = summarizeGenerations(generations, { "gen-1": { model: "openai/gpt-oss-120b", provider: "Groq", costUsd: 0 } }, "anthropic/claude-haiku-5.5");
  assert.equal(s.pending, 2);
  assert.deepEqual(s.roles, [{ role: "orchestratore", models: [{ model: "openai/gpt-oss-120b", providers: ["Groq"], fallback: true }] }]);
});
