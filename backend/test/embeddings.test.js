import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findLocalModel } from "../src/embeddings/catalog.js";
import { downloadModel, isDownloaded, LocalEmbeddings } from "../src/embeddings/local.js";
import { calibrateThreshold, collectionName, createEmbeddingService, createEmbeddingSwitcher } from "../src/embeddings/service.js";
import { assessModel } from "../src/embeddings/system.js";
import { createSettingsStore, openDatabase } from "../src/storage/db.js";

const machine = (over = {}) => ({
  platform: "linux", arch: "x64", libc: "glibc", runtimeSupported: true, container: false, cpus: 4,
  memTotalMb: 4000, memAvailableMb: 2400, memLimitedByContainer: false, diskFreeMb: 80000, ...over,
});
const small = findLocalModel("Xenova/multilingual-e5-small");
const bge = findLocalModel("Xenova/bge-m3");

test("collection: il modello di default mantiene il nome del .env, gli altri hanno un nome proprio", () => {
  const defaults = { provider: "openrouter", model: "nvidia/nemotron-3.5-embed-1b:free" };
  assert.equal(collectionName("wayfare_handbook", defaults, defaults), "wayfare_handbook");
  const local = collectionName("wayfare_handbook", defaults, { provider: "local", model: small.id });
  assert.match(local, /^wayfare_handbook-local-xenova-multilingual-e5-small-[0-9a-f]{8}$/);
  assert.notEqual(local, collectionName("wayfare_handbook", defaults, { provider: "openrouter", model: small.id }));
});

test("valutazione della macchina: ok, al limite, insufficiente, non supportata", () => {
  assert.equal(assessModel(small, machine()).verdict, "ok");
  assert.equal(assessModel(bge, machine({ memAvailableMb: 1600 })).verdict, "limite");
  const low = assessModel(bge, machine({ memAvailableMb: 900, memLimitedByContainer: true }));
  assert.equal(low.verdict, "insufficiente");
  assert.match(low.reasons[0], /container/);
  assert.equal(assessModel(small, machine({ diskFreeMb: 50 })).verdict, "insufficiente");
  assert.equal(assessModel(small, machine({ diskFreeMb: 50 }), { downloaded: true }).verdict, "ok");
  const alpine = assessModel(small, machine({ libc: "musl", runtimeSupported: false }));
  assert.equal(alpine.verdict, "non_supportato");
  assert.match(alpine.reasons[0], /Alpine/);
  assert.equal(assessModel(small, machine({ cpus: 1 })).verdict, "limite");
});

const fakeModel = (content, sha) => ({
  id: "test/modello", revision: "abc", files: [{ path: "onnx/model.onnx", size: content.length, sha256: sha }],
});
const fetchOf = (content) => async () => new Response(content, { status: 200 });

test("download: streaming su disco, verifica dimensione e SHA-256", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emb-"));
  const content = Buffer.from("pesi del modello");
  const model = fakeModel(content, createHash("sha256").update(content).digest("hex"));
  const progress = [];
  await downloadModel(dir, model, { fetchImpl: fetchOf(content), onProgress: (d, t) => progress.push([d, t]) });
  assert.ok(isDownloaded(dir, model));
  assert.deepEqual(readFileSync(path.join(dir, "test/modello/onnx/model.onnx")), content);
  assert.deepEqual(progress.at(-1), [content.length, content.length]);
});

test("download: un file alterato viene rifiutato e non resta su disco", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "emb-"));
  const model = fakeModel(Buffer.from("pesi originali"), "0".repeat(64));
  await assert.rejects(downloadModel(dir, model, { fetchImpl: fetchOf(Buffer.from("pesi originali")) }), /SHA-256/);
  assert.ok(!existsSync(path.join(dir, "test/modello/onnx/model.onnx")));
  assert.ok(!existsSync(path.join(dir, "test/modello/onnx/model.onnx.part")));
});

test("embedding locali: prefissi E5 per documenti e domande, a blocchi", async () => {
  const seen = [];
  const emb = new LocalEmbeddings({ model: small, modelsDir: "/non-usata" });
  emb.loading = Promise.resolve(async (texts, opts) => {
    seen.push({ texts, opts });
    return { tolist: () => texts.map(() => [1, 0]) };
  });
  const docs = await emb.embedDocuments(Array.from({ length: 10 }, (_, i) => `testo ${i}`));
  assert.equal(docs.length, 10);
  assert.equal(seen.length, 2); // blocchi da 8
  assert.equal(seen[0].texts[0], "passage: testo 0");
  assert.deepEqual(seen[0].opts, { pooling: "mean", normalize: true });
  await emb.embedQuery("penali");
  assert.equal(seen.at(-1).texts[0], "query: penali");
});

test("soglia calibrata: 75° percentile delle domande fuori tema", () => {
  assert.equal(calibrateThreshold([0.81, 0.8, 0.74, 0.79, 0.8, 0.8, 0.78, 0.77]), 0.8);
  assert.equal(calibrateThreshold([0.11, 0.14, 0.1, 0.07, 0.08, 0.21, 0.09, 0.12]), 0.12);
});

function makeService(store) {
  const config = {
    EMBEDDING_PROVIDER: "openrouter", EMBEDDING_MODEL: "nvidia/nemotron-3.5-embed-1b:free", CHROMA_COLLECTION: "kb",
    MODELS_DIR: "/tmp/non-usata", OPENROUTER_BASE_URL: "https://openrouter.test/api/v1", RAG_MIN_SIMILARITY: 0.2,
  };
  const fetchImpl = async () => Response.json({ data: [{ id: "openai/text-embedding-3-small", name: "OpenAI: Small", pricing: { prompt: "0.00000002" } }] });
  return createEmbeddingService({ config, store, getApiKey: () => "k", log: { info() {}, error() {} }, fetchImpl, machine });
}

test("cambio di modello: indicizza, verifica e solo allora attiva", async () => {
  const store = createSettingsStore(openDatabase(":memory:"));
  const service = makeService(store);
  const calls = [];
  const indexer = {
    indexAll: async ({ target, onProgress } = {}) => {
      calls.push(target?.collection ?? "attiva");
      onProgress?.(1, 1);
      return [{ id: "doc.md", skipped: false, chunks: 39 }];
    },
    sample: async () => ({ chunks: 39, sample: "testo" }),
  };
  // il passaggio di prova ritrova sé stesso (0,91); le domande fuori tema arrivano al massimo a 0,2
  const offTopic = [0.05, 0.08, 0.1, 0.11, 0.12, 0.14, 0.16, 0.2];
  let call = 0;
  const retriever = { search: async () => [{ similarity: call++ === 0 ? 0.91 : offTopic[(call - 2) % 8] }] };
  const switcher = createEmbeddingSwitcher({ service, indexer, retriever, log: { info() {}, error() {} } });
  await assert.rejects(switcher.start({ provider: "openrouter", model: "nvidia/nemotron-3.5-embed-1b:free" }), /già in uso/);
  await assert.rejects(switcher.start({ provider: "openrouter", model: "inesistente/x" }), /non trovato/);

  const state = await switcher.start({ provider: "openrouter", model: "openai/text-embedding-3-small" });
  assert.equal(state.status, "running");
  await assert.rejects(switcher.start({ provider: "openrouter", model: "openai/text-embedding-3-small" }), /già in corso/);
  while (switcher.state().status === "running") await new Promise((r) => setTimeout(r, 5));
  assert.equal(switcher.state().status, "done");
  assert.equal(switcher.state().result.chunks, 39);
  assert.equal(service.current().model, "openai/text-embedding-3-small");
  assert.equal(service.current().source, "ui");
  assert.equal(calls[0], service.current().collection); // prima la collection nuova, poi riallineamento di quella attiva
  assert.equal(service.current().minSimilarity, 0.14); // 75° percentile delle domande fuori tema
  assert.equal(service.current().thresholdSource, "calibrata");
});

test("cambio fallito: resta in uso il modello precedente", async () => {
  const store = createSettingsStore(openDatabase(":memory:"));
  const service = makeService(store);
  const indexer = { indexAll: async () => { throw new Error("Chroma non raggiungibile"); } };
  const switcher = createEmbeddingSwitcher({ service, indexer, retriever: {}, log: { info() {}, error() {} } });
  await switcher.start({ provider: "openrouter", model: "openai/text-embedding-3-small" });
  while (switcher.state().status === "running") await new Promise((r) => setTimeout(r, 5));
  assert.equal(switcher.state().status, "error");
  assert.match(switcher.state().error, /Resta in uso il modello precedente/);
  assert.equal(service.current().model, "nvidia/nemotron-3.5-embed-1b:free");
});

test("un modello locale troppo grande per la macchina viene rifiutato prima di iniziare", async () => {
  const store = createSettingsStore(openDatabase(":memory:"));
  const config = { EMBEDDING_PROVIDER: "openrouter", EMBEDDING_MODEL: "m", CHROMA_COLLECTION: "kb", MODELS_DIR: "/tmp/non-usata" };
  const service = createEmbeddingService({ config, store, getApiKey: () => "k", log: {}, machine: () => machine({ memAvailableMb: 500 }) });
  const switcher = createEmbeddingSwitcher({ service, indexer: {}, retriever: {}, log: {} });
  await assert.rejects(switcher.start({ provider: "local", model: bge.id }), /Memoria insufficiente/);
});
