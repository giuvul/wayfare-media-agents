import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createDocumentStore, slugify } from "../src/rag/documents.js";
import { maskKey, searchModels, createSettingsService } from "../src/settings.js";
import { createConversationStore, createSettingsStore, openDatabase, titleFrom } from "../src/storage/db.js";

test("conversazioni: creazione, messaggi in ordine, eliminazione a cascata", () => {
  const store = createConversationStore(openDatabase(":memory:"));
  const id = randomUUID();
  store.ensure(id, "Quanto vale il make-good?");
  store.ensure(id, "secondo messaggio: non cambia il titolo");
  store.addMessage(id, { id: randomUUID(), role: "user", text: "uno" });
  store.addMessage(id, { id: randomUUID(), role: "assistant", text: "due", steps: [{ tool: "x" }] });
  assert.equal(store.get(id).title, "Quanto vale il make-good?");
  assert.deepEqual(store.messages(id).map((m) => m.text), ["uno", "due"]);
  assert.equal(store.list().length, 1);
  assert.equal(store.remove(id), true);
  assert.equal(store.messages(id).length, 0);
  assert.equal(titleFrom("x".repeat(100)).length, 68);
});

const fakeOpenRouter = (validKey) => async (url, opts = {}) => {
  if (String(url).endsWith("/key")) {
    const ok = opts.headers?.Authorization === `Bearer ${validKey}`;
    return new Response(JSON.stringify(ok ? { data: { label: "k", usage: 0.1, limit: 100 } } : { error: "no" }), { status: ok ? 200 : 401 });
  }
  return new Response(JSON.stringify({ data: [
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supported_parameters: ["tools"], pricing: { prompt: "0.00000005", completion: "0.0000002" } },
    { id: "vendor/no-tools", name: "Senza tool", supported_parameters: [], pricing: {} },
  ] }));
};

test("impostazioni: chiave validata e mai restituita in chiaro, modello dal catalogo con tool", async () => {
  const config = { OPENROUTER_API_KEY: "sk-or-env-0000000000000000", LLM_MODEL: "env/model", LLM_FALLBACK_MODELS: [], OPENROUTER_BASE_URL: "https://or.test/api/v1", EMBEDDING_MODEL: "e" };
  const good = "sk-or-v1-abcdefghijklmnopqrstuvwxyz1234";
  const settings = createSettingsService({ config, store: createSettingsStore(openDatabase(":memory:")), fetchImpl: fakeOpenRouter(good) });
  assert.equal(settings.get().apiKeySource, "env");
  await assert.rejects(settings.update({ apiKey: "sk-or-v1-chiave-sbagliata-0000000000" }), /rifiutato/);
  const v0 = settings.version;
  const described = await settings.update({ apiKey: good, model: "deepseek/deepseek-v4.1-flash" });
  assert.equal(settings.version, v0 + 1);
  assert.equal(described.apiKey.masked, "sk-or-v1…1234");
  assert.doesNotMatch(JSON.stringify(described), new RegExp(good));
  assert.deepEqual(settings.dataAgentOverride(), { model: "deepseek/deepseek-v4.1-flash", api_key: good });
  await assert.rejects(settings.update({ model: "vendor/no-tools" }), /tool calling/);
  await settings.update({ resetApiKey: true, resetModel: true });
  assert.deepEqual(settings.dataAgentOverride(), { model: "env/model" });
  assert.equal(maskKey(null), null);
});

test("ricerca modelli: tutti i termini, su id e nome", () => {
  const models = [{ id: "a/deepseek-flash", name: "DeepSeek Flash" }, { id: "b/gpt", name: "GPT" }];
  assert.deepEqual(searchModels(models, "deep flash").map((m) => m.id), ["a/deepseek-flash"]);
  assert.equal(searchModels(models, "").length, 2);
});

test("documenti: nomi sicuri, scrittura atomica, niente path traversal", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kb-"));
  const docs = createDocumentStore(dir);
  await docs.write("note.md", "---\ntitle: \"Note\"\n---\n\n# 1. Uno\nTesto", { create: true });
  await assert.rejects(docs.write("note.md", "x", { create: true }), /Esiste già/);
  await assert.rejects(docs.load("../etc/passwd"), /non valido/);
  await assert.rejects(docs.load("altro.md"), /non trovato/);
  const doc = await docs.load("note.md");
  assert.equal(doc.title, "Note");
  assert.equal(doc.sections[0].id, "1");
  assert.match(readFileSync(path.join(dir, "note.md"), "utf8"), /# 1\. Uno\nTesto\n$/); // newline finale aggiunto
  assert.equal((await docs.list())[0].editable, true);
  assert.equal(slugify("Policy È Nuova!"), "policy_e_nuova");
});

test("PDF dell'handbook: letto e diviso in sezioni come il Markdown", async () => {
  const repo = path.resolve(import.meta.dirname, "..", "..");
  const docs = createDocumentStore(path.join(repo, "docs"));
  const doc = await docs.load("wayfare_media_handbook.pdf");
  assert.ok(doc.sections.length >= 30);
  assert.equal(doc.sections.find((s) => s.id === "4.3").page, 5);
});
