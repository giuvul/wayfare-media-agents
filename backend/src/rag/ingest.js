// Ingestion della knowledge base in ChromaDB. Idempotente: si può rieseguire senza duplicare nulla.
//   npm run ingest              indicizza (salta se il PDF non è cambiato)
//   npm run ingest -- --reset   ricrea la collection (es. dopo aver cambiato modello di embedding)
//
// È l'UNICO processo che scrive su Chroma: il server della chat legge soltanto.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

import { loadConfig } from "../config.js";
import { createEmbeddings } from "../llm.js";
import { createLogger } from "../logger.js";
import { buildChunks, splitIntoSections } from "./chunking.js";
import { createChromaClient, getOrCreateKbCollection } from "./chroma.js";

const DOC_TITLE = "Handbook Wayfare Media";

export async function readPdfPages(pdfPath) {
  const buffer = await readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return { pages: text, sha256: createHash("sha256").update(buffer).digest("hex") };
}

export async function ingest({ config, log, reset = false }) {
  const source = path.basename(config.KB_PDF_PATH);
  const client = createChromaClient(config.CHROMA_URL);
  if (reset) {
    await client.deleteCollection({ name: config.CHROMA_COLLECTION }).catch(() => {});
    log.info({ collection: config.CHROMA_COLLECTION }, "collection eliminata");
  }
  const collection = await getOrCreateKbCollection(client, config.CHROMA_COLLECTION, config.EMBEDDING_MODEL);
  if (collection.metadata?.embedding_model && collection.metadata.embedding_model !== config.EMBEDDING_MODEL) {
    throw new Error("Modello di embedding cambiato: riesegui con --reset per ricreare l'indice.");
  }

  const { pages, sha256 } = await readPdfPages(config.KB_PDF_PATH);
  const existing = await collection.get({ where: { source }, limit: 1, include: ["metadatas"] });
  if (existing.ids.length && existing.metadatas[0]?.sha256 === sha256) {
    log.info({ source, chunks: await collection.count() }, "documento invariato: niente da fare");
    return { skipped: true };
  }

  const sections = splitIntoSections(pages);
  const chunks = await buildChunks(sections, { docTitle: DOC_TITLE });
  log.info({ source, pages: pages.length, sections: sections.length, chunks: chunks.length }, "documento suddiviso");

  const embeddings = await createEmbeddings(config).embedDocuments(chunks.map((c) => c.text));
  // Prima elimina i chunk della versione precedente dello stesso documento, poi inserisce i nuovi.
  await collection.delete({ where: { source } });
  await collection.add({
    ids: chunks.map((_, i) => `${source}:${sha256.slice(0, 12)}:${i}`),
    embeddings,
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((c) => ({ ...c.metadata, source, sha256 })),
  });
  log.info({ source, chunks: await collection.count(), dimensions: embeddings[0]?.length }, "indicizzazione completata");
  return { skipped: false, chunks: chunks.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  ingest({ config, log, reset: process.argv.includes("--reset") }).catch((err) => {
    log.error({ err: err.message }, "ingestion fallita");
    process.exit(1);
  });
}
