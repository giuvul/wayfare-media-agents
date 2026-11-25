// Accesso a ChromaDB (server locale). Gli embedding li calcoliamo noi: Chroma conserva vettori e metadati.
import { ChromaClient } from "chromadb";

export function createChromaClient(chromaUrl) {
  const url = new URL(chromaUrl);
  return new ChromaClient({
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    ssl: url.protocol === "https:",
  });
}

/** Collection per la scrittura (ingestion): spazio coseno, così la soglia di similarità ha un significato. */
export async function getOrCreateKbCollection(client, name, embeddingModel) {
  return client.getOrCreateCollection({
    name,
    embeddingFunction: null,
    configuration: { hnsw: { space: "cosine" } },
    metadata: { embedding_model: embeddingModel, description: "Knowledge base Wayfare Media" },
  });
}

/** Collection per la lettura (chat): deve esistere ed essere stata indicizzata con lo stesso modello. */
export async function getKbCollection(client, name, embeddingModel) {
  const collection = await client.getCollection({ name, embeddingFunction: null });
  const indexedWith = collection.metadata?.embedding_model;
  if (indexedWith && indexedWith !== embeddingModel) {
    throw new Error(
      `La knowledge base è indicizzata con "${indexedWith}" ma EMBEDDING_MODEL è "${embeddingModel}": ` +
        "riesegui `npm run ingest -- --reset`.",
    );
  }
  return collection;
}
