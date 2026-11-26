// Indicizzazione della knowledge base in ChromaDB. Idempotente: si può rieseguire senza duplicare nulla.
//   npm run ingest              indicizza tutti i documenti di KB_DIR (salta quelli invariati)
//   npm run ingest -- --reset   ricrea la collection del modello di embedding attivo
//
// Ogni modello di embedding ha la sua collection (`target.collection`); senza target si usa quello attivo.
// Una sola scrittura alla volta: dentro il server le operazioni passano da una coda; il comando da terminale
// va usato per il primo caricamento, prima di avviare il server (in docker compose è un servizio one-shot).
import { loadConfig } from "../config.js";
import { createEmbeddingService } from "../embeddings/service.js";
import { createLogger } from "../logger.js";
import { createSettingsStore, openDatabase } from "../storage/db.js";
import { buildChunks } from "./chunking.js";
import { assertSameModel, createChromaClient, getOrCreateKbCollection } from "./chroma.js";
import { createDocumentStore } from "./documents.js";

export function createIndexer({ config, embeddings, documents, log }) {
  const client = createChromaClient(config.CHROMA_URL);
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function collection(target) {
    const kb = await getOrCreateKbCollection(client, target.collection, target.key);
    assertSameModel(kb, target.key);
    return kb;
  }

  async function indexOne(kb, target, id, force) {
    const doc = await documents.load(id);
    const existing = await kb.get({ where: { source: id }, limit: 1, include: ["metadatas"] });
    if (!force && existing.ids.length && existing.metadatas[0]?.sha256 === doc.sha256) {
      return { id, skipped: true, chunks: 0 };
    }
    const chunks = await buildChunks(doc.sections, { docTitle: doc.title });
    const vectors = chunks.length ? await embeddings.getEmbeddings(target).embedDocuments(chunks.map((c) => c.text)) : [];
    // prima si eliminano i chunk della versione precedente dello stesso documento, poi si inseriscono i nuovi
    await kb.delete({ where: { source: id } });
    if (chunks.length) {
      await kb.add({
        ids: chunks.map((_, i) => `${id}:${doc.sha256.slice(0, 12)}:${i}`),
        embeddings: vectors,
        documents: chunks.map((c) => c.text),
        metadatas: chunks.map((c) => ({ ...c.metadata, source: id, doc_title: doc.title, sha256: doc.sha256 })),
      });
    }
    log.info({ source: id, chunks: chunks.length, embedding: target.key }, "documento indicizzato");
    return { id, skipped: false, chunks: chunks.length };
  }

  return {
    indexDocument: (id, { force = false } = {}) =>
      serialized(async () => {
        const target = embeddings.current();
        return indexOne(await collection(target), target, id, force);
      }),
    removeDocument: (id) =>
      serialized(async () => {
        await (await collection(embeddings.current())).delete({ where: { source: id } });
        log.info({ source: id }, "documento rimosso dall'indice");
      }),
    /** Allinea l'indice alla cartella: nuovi e modificati indicizzati, eliminati rimossi. */
    indexAll: ({ reset = false, target, onProgress = () => {} } = {}) =>
      serialized(async () => {
        const t = target ?? embeddings.current();
        if (reset) {
          await client.deleteCollection({ name: t.collection }).catch(() => {});
          log.info({ collection: t.collection }, "collection eliminata");
        }
        const kb = await collection(t);
        const ids = (await documents.list()).map((d) => d.id);
        const results = [];
        onProgress(0, ids.length);
        for (const id of ids) {
          results.push(await indexOne(kb, t, id, false));
          onProgress(results.length, ids.length);
        }
        const indexed = new Set((await kb.get({ include: ["metadatas"] })).metadatas.map((m) => m?.source));
        for (const stale of [...indexed].filter((s) => s && !ids.includes(s))) {
          await kb.delete({ where: { source: stale } });
          log.info({ source: stale }, "documento non più presente: rimosso dall'indice");
        }
        log.info({ documents: ids.length, chunks: await kb.count(), collection: t.collection }, "indicizzazione completata");
        return results;
      }),
    /** Numero di chunk e un passaggio di esempio (per la ricerca di prova dopo un cambio di modello). */
    async sample(target) {
      const kb = await collection(target);
      const { documents: docs } = await kb.get({ limit: 1, include: ["documents"] });
      return { chunks: await kb.count(), sample: docs[0]?.slice(0, 300) ?? "" };
    },
    /** Numero di chunk indicizzati per documento, nella collection attiva. */
    async counts() {
      const kb = await collection(embeddings.current());
      const { metadatas } = await kb.get({ include: ["metadatas"] });
      const counts = {};
      for (const m of metadatas) counts[m.source] = (counts[m.source] ?? 0) + 1;
      return counts;
    },
  };
}

if (import.meta.main) {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  // rispetta modello di embedding e chiave scelti dall'interfaccia, se ci sono
  const db = openDatabase(config.STORAGE_DIR);
  const store = createSettingsStore(db);
  const getApiKey = () => store.get("openrouter_api_key") ?? config.OPENROUTER_API_KEY;
  const embeddings = createEmbeddingService({ config, store, getApiKey, log });
  const indexer = createIndexer({ config, log, embeddings, documents: createDocumentStore(config.KB_DIR) });
  indexer
    .indexAll({ reset: process.argv.includes("--reset") })
    .then(() => process.exit(0)) // il modello locale tiene vivo il processo: si esce esplicitamente
    .catch((err) => {
      log.error({ err: err.message }, "indicizzazione fallita: controlla OPENROUTER_API_KEY nel file .env e la connessione");
      process.exit(1);
    });
}
