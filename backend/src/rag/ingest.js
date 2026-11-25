// Indicizzazione della knowledge base in ChromaDB. Idempotente: si può rieseguire senza duplicare nulla.
//   npm run ingest              indicizza tutti i documenti di KB_DIR (salta quelli invariati)
//   npm run ingest -- --reset   ricrea la collection (es. dopo aver cambiato modello di embedding)
//
// Una sola scrittura alla volta: dentro il server le operazioni passano da una coda; il comando da terminale
// va usato per il primo caricamento, prima di avviare il server (in docker compose è un servizio one-shot).
import { loadConfig } from "../config.js";
import { embeddingsProvider } from "../llm.js";
import { createLogger } from "../logger.js";
import { buildChunks } from "./chunking.js";
import { createChromaClient, getOrCreateKbCollection } from "./chroma.js";
import { createDocumentStore } from "./documents.js";

export function createIndexer({ config, getEmbeddings, documents, log }) {
  const client = createChromaClient(config.CHROMA_URL);
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function collection() {
    const kb = await getOrCreateKbCollection(client, config.CHROMA_COLLECTION, config.EMBEDDING_MODEL);
    const indexedWith = kb.metadata?.embedding_model;
    if (indexedWith && indexedWith !== config.EMBEDDING_MODEL) {
      throw new Error(`La knowledge base è indicizzata con "${indexedWith}": riesegui \`npm run ingest -- --reset\`.`);
    }
    return kb;
  }

  async function indexOne(kb, id, force) {
    const doc = await documents.load(id);
    const existing = await kb.get({ where: { source: id }, limit: 1, include: ["metadatas"] });
    if (!force && existing.ids.length && existing.metadatas[0]?.sha256 === doc.sha256) {
      return { id, skipped: true };
    }
    const chunks = await buildChunks(doc.sections, { docTitle: doc.title });
    const embeddings = chunks.length ? await getEmbeddings().embedDocuments(chunks.map((c) => c.text)) : [];
    // prima si eliminano i chunk della versione precedente dello stesso documento, poi si inseriscono i nuovi
    await kb.delete({ where: { source: id } });
    if (chunks.length) {
      await kb.add({
        ids: chunks.map((_, i) => `${id}:${doc.sha256.slice(0, 12)}:${i}`),
        embeddings,
        documents: chunks.map((c) => c.text),
        metadatas: chunks.map((c) => ({ ...c.metadata, source: id, doc_title: doc.title, sha256: doc.sha256 })),
      });
    }
    log.info({ source: id, sections: doc.sections.length, chunks: chunks.length }, "documento indicizzato");
    return { id, skipped: false, chunks: chunks.length };
  }

  return {
    indexDocument: (id, { force = false } = {}) => serialized(async () => indexOne(await collection(), id, force)),
    removeDocument: (id) =>
      serialized(async () => {
        await (await collection()).delete({ where: { source: id } });
        log.info({ source: id }, "documento rimosso dall'indice");
      }),
    indexAll: ({ reset = false } = {}) =>
      serialized(async () => {
        if (reset) {
          await client.deleteCollection({ name: config.CHROMA_COLLECTION }).catch(() => {});
          log.info({ collection: config.CHROMA_COLLECTION }, "collection eliminata");
        }
        const kb = await collection();
        const ids = (await documents.list()).map((d) => d.id);
        const results = [];
        for (const id of ids) results.push(await indexOne(kb, id, false));
        // i documenti eliminati dalla cartella escono anche dall'indice
        const indexed = new Set((await kb.get({ include: ["metadatas"] })).metadatas.map((m) => m?.source));
        for (const stale of [...indexed].filter((s) => s && !ids.includes(s))) {
          await kb.delete({ where: { source: stale } });
          log.info({ source: stale }, "documento non più presente: rimosso dall'indice");
        }
        log.info({ documents: ids.length, chunks: await kb.count() }, "indicizzazione completata");
        return results;
      }),
    /** Numero di chunk indicizzati per documento. */
    async counts() {
      const kb = await collection();
      const { metadatas } = await kb.get({ include: ["metadatas"] });
      const counts = {};
      for (const m of metadatas) counts[m.source] = (counts[m.source] ?? 0) + 1;
      return counts;
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const indexer = createIndexer({
    config,
    log,
    getEmbeddings: embeddingsProvider(config, () => config.OPENROUTER_API_KEY),
    documents: createDocumentStore(config.KB_DIR),
  });
  indexer.indexAll({ reset: process.argv.includes("--reset") }).catch((err) => {
    log.error({ err: err.message }, "indicizzazione fallita");
    process.exit(1);
  });
}
