// Tool RAG: cerca nella knowledge base. Il modello riceve i passaggi con la fonte da citare;
// l'interfaccia riceve (come artifact, invisibile al modello) i metadati delle fonti da mostrare.
import { tool } from "langchain";
import { z } from "zod";

export const KB_TOOL_NAME = "cerca_documentazione";

export function formatPassages(hits) {
  if (hits.length === 0) {
    return "Nessun passaggio pertinente trovato nella documentazione aziendale. Non rispondere con conoscenze generiche: dillo all'utente.";
  }
  return hits
    .map((h, i) => {
      const where = `${h.docTitle} · §${h.section} ${h.sectionTitle}${h.page ? ` (p. ${h.page})` : ""}`;
      return `[Fonte ${i + 1}] ${where} — cita come [§${h.section}]\n${h.text.split("\n").slice(1).join("\n")}`;
    })
    .join("\n\n");
}

export function createKnowledgeBaseTool(retriever) {
  return tool(
    async ({ query }) => {
      const hits = await retriever.search(query);
      const sources = hits.map(({ source, docTitle, section, sectionTitle, page, similarity, text }) => ({
        source, docTitle, section, sectionTitle, page, similarity, excerpt: text.split("\n").slice(1).join(" ").slice(0, 400),
      }));
      return [formatPassages(hits), { query, sources }];
    },
    {
      name: KB_TOOL_NAME,
      description:
        "Cerca nella documentazione aziendale di Wayfare Media (handbook e altri documenti della knowledge base): regole e policy (listino CPM, sconti, condizioni di vendita, " +
        "cancellazioni, garanzia di erogazione e make-good, specifiche dei formati, policy sui contenuti, privacy, " +
        "metodologia di misurazione, definizioni dei KPI, segmenti di audience, procedure, FAQ). " +
        "Usalo per domande su COME funziona qualcosa o QUALI regole valgono, e per recuperare le regole da applicare ai dati.",
      schema: z.object({
        query: z.string().min(3).describe("Domanda di ricerca autonoma in italiano, con i termini chiave (es. 'penali di cancellazione campagna')."),
      }),
      responseFormat: "content_and_artifact",
    },
  );
}
