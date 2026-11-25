// Retrieval semantico: embedding della domanda, top-k su Chroma (coseno), filtro per soglia di similarità.
import { createChromaClient, getKbCollection } from "./chroma.js";

export function createRetriever({ config, embeddings }) {
  const client = createChromaClient(config.CHROMA_URL);
  let collectionPromise = null;
  const collection = () => {
    collectionPromise ??= getKbCollection(client, config.CHROMA_COLLECTION, config.EMBEDDING_MODEL).catch((err) => {
      collectionPromise = null; // riprova alla prossima richiesta (es. ingestion non ancora eseguita)
      throw err;
    });
    return collectionPromise;
  };

  return {
    async search(query, { topK = config.RAG_TOP_K, minSimilarity = config.RAG_MIN_SIMILARITY } = {}) {
      const [vector, kb] = await Promise.all([embeddings.embedQuery(query), collection()]);
      const res = await kb.query({
        queryEmbeddings: [vector],
        nResults: topK,
        include: ["documents", "metadatas", "distances"],
      });
      return res.ids[0]
        .map((id, i) => ({
          id,
          text: res.documents[0][i],
          similarity: Number((1 - res.distances[0][i]).toFixed(3)), // distanza coseno -> similarità
          section: res.metadatas[0][i].section_id,
          sectionTitle: res.metadatas[0][i].section_title,
          page: res.metadatas[0][i].page,
        }))
        .filter((hit) => hit.similarity >= minSimilarity);
    },
    async status() {
      const kb = await collection();
      return { chunks: await kb.count(), embeddingModel: kb.metadata?.embedding_model };
    },
  };
}
