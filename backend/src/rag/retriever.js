// Retrieval semantico: embedding della domanda, top-k su Chroma (coseno), filtro per soglia di similarità.
import { createChromaClient, getKbCollection } from "./chroma.js";

export function createRetriever({ config, getEmbeddings }) {
  const client = createChromaClient(config.CHROMA_URL);
  let collectionPromise = null;
  const collection = () => {
    collectionPromise ??= getKbCollection(client, config.CHROMA_COLLECTION, config.EMBEDDING_MODEL).catch((err) => {
      collectionPromise = null; // riprova alla prossima richiesta (es. indicizzazione non ancora eseguita)
      throw err;
    });
    return collectionPromise;
  };

  async function query(vector, topK) {
    try {
      return await (await collection()).query({ queryEmbeddings: [vector], nResults: topK, include: ["documents", "metadatas", "distances"] });
    } catch (err) {
      collectionPromise = null; // collection ricreata da un reset: si riprova una volta con un handle nuovo
      return (await collection()).query({ queryEmbeddings: [vector], nResults: topK, include: ["documents", "metadatas", "distances"] }).catch(() => {
        throw err;
      });
    }
  }

  return {
    async search(text, { topK = config.RAG_TOP_K, minSimilarity = config.RAG_MIN_SIMILARITY } = {}) {
      const vector = await getEmbeddings().embedQuery(text);
      const res = await query(vector, topK);
      return res.ids[0]
        .map((id, i) => {
          const meta = res.metadatas[0][i];
          return {
            id,
            text: res.documents[0][i],
            similarity: Number((1 - res.distances[0][i]).toFixed(3)), // distanza coseno -> similarità
            source: meta.source,
            docTitle: meta.doc_title ?? meta.source,
            section: meta.section_id,
            sectionTitle: meta.section_title,
            page: meta.page ?? null,
          };
        })
        .filter((hit) => hit.similarity >= minSimilarity);
    },
    async status() {
      const kb = await collection();
      return { chunks: await kb.count(), embeddingModel: kb.metadata?.embedding_model };
    },
  };
}
