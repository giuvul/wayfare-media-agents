// Retrieval semantico: embedding della domanda, top-k su Chroma (coseno), filtro per soglia di similarità.
// Usa il modello di embedding attivo (o quello indicato, per la ricerca di prova durante un cambio).
import { createChromaClient, getKbCollection } from "./chroma.js";

export function createRetriever({ config, embeddings }) {
  const client = createChromaClient(config.CHROMA_URL);
  const handles = new Map(); // collection -> promessa dell'handle

  const collection = (target) => {
    if (!handles.has(target.collection)) {
      handles.set(target.collection, getKbCollection(client, target.collection, target.key).catch((err) => {
        handles.delete(target.collection); // riprova alla prossima richiesta (es. indicizzazione non ancora eseguita)
        throw err;
      }));
    }
    return handles.get(target.collection);
  };

  async function query(target, vector, topK) {
    const args = { queryEmbeddings: [vector], nResults: topK, include: ["documents", "metadatas", "distances"] };
    try {
      return await (await collection(target)).query(args);
    } catch (err) {
      handles.delete(target.collection); // collection ricreata da un reset: si riprova una volta con un handle nuovo
      return (await collection(target)).query(args).catch(() => {
        throw err;
      });
    }
  }

  return {
    async search(text, { topK = config.RAG_TOP_K, target = embeddings.current(), minSimilarity = target.minSimilarity } = {}) {
      const vector = await embeddings.getEmbeddings(target).embedQuery(text);
      const res = await query(target, vector, topK);
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
      const target = embeddings.current();
      const kb = await collection(target);
      return { chunks: await kb.count(), embeddingModel: target.model, embeddingProvider: target.provider, minSimilarity: target.minSimilarity };
    },
  };
}
