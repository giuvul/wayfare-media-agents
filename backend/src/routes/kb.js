// Knowledge Base: documenti (gestiti dal back end e indicizzati in Chroma) e dati (gestiti dal data agent).
import express from "express";
import { z } from "zod";

import { HttpError } from "../errors.js";
import { DOC_NAME, MAX_DOC_CHARS, slugify } from "../rag/documents.js";

const DocContent = z.object({ content: z.string().min(1).max(MAX_DOC_CHARS) });
const NewDoc = z.object({ title: z.string().trim().min(3).max(120), content: z.string().min(1).max(MAX_DOC_CHARS) });
const CellUpdate = z.object({ column: z.string().min(1).max(64), value: z.string().max(200) });
const DataQuery = z.object({
  view: z.enum(["raw", "clean"]).default("raw"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().max(100).default(""),
});
// un aggiornamento della pulizia già in corso (409) può durare minuti se l'AI rigenera il codice
const REFRESH_RETRY_MS = 5_000;
const REFRESH_MAX_ATTEMPTS = 120;

export function kbRouter({ documents, indexer, dataAgent, settings, log }) {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  const docId = (req) => {
    if (!DOC_NAME.test(req.params.id)) throw new HttpError("Nome di documento non valido.");
    return req.params.id;
  };

  // --- Documenti -----------------------------------------------------------------------------
  router.get(
    "/kb/documents",
    async (_req, res) => {
      const [docs, counts] = await Promise.all([documents.list(), indexer.counts().catch(() => null)]);
      res.json({ documents: docs.map((d) => ({ ...d, chunks: counts ? counts[d.id] ?? 0 : null })) });
    },
  );

  router.get(
    "/kb/documents/:id",
    async (req, res) => {
      const { sha256: _sha, ...doc } = await documents.load(docId(req));
      res.json({ ...doc, sections: doc.sections.map(({ text: _t, ...s }) => s) });
    },
  );

  router.get("/kb/documents/:id/raw", async (req, res) => res.json({ content: await documents.raw(docId(req)) }));

  router.put(
    "/kb/documents/:id",
    async (req, res) => {
      const id = docId(req);
      const parsed = DocContent.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Contenuto non valido." });
      await documents.write(id, parsed.data.content);
      const indexed = await indexer.indexDocument(id);
      res.json({ id, indexed });
    },
  );

  router.post(
    "/kb/documents",
    async (req, res) => {
      const parsed = NewDoc.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Titolo (almeno 3 caratteri) e contenuto sono obbligatori." });
      const { title, content } = parsed.data;
      const id = `${slugify(title)}.md`;
      const body = content.startsWith("---\n") ? content : `---\ntitle: "${title.replaceAll('"', "'")}"\n---\n\n${content}`;
      await documents.write(id, body, { create: true });
      const indexed = await indexer.indexDocument(id);
      res.status(201).json({ id, indexed });
    },
  );

  router.delete(
    "/kb/documents/:id",
    async (req, res) => {
      const id = docId(req);
      await documents.remove(id);
      await indexer.removeDocument(id);
      res.status(204).end();
    },
  );

  // --- Dati (proxy verso il data agent) --------------------------------------------------------
  // Dopo ogni modifica la pulizia viene aggiornata: il data agent riusa il codice già validato se supera
  // ancora i controlli, altrimenti lo rigenera con l'LLM. Se un aggiornamento è già in corso si riprova.
  let pendingRefresh = null;
  const refreshCleaning = () => {
    if (pendingRefresh) return;
    const attempt = async (n) => {
      try {
        await dataAgent.rebuildCleaning("refresh", settings.dataAgentOverride());
        pendingRefresh = null;
      } catch (err) {
        if (err.status === 409 && n < REFRESH_MAX_ATTEMPTS) {
          pendingRefresh = setTimeout(() => attempt(n + 1), REFRESH_RETRY_MS);
        } else {
          pendingRefresh = null;
          log.error({ err: err.message }, "aggiornamento della pulizia non avviato");
        }
      }
    };
    pendingRefresh = setTimeout(() => attempt(0), 0);
  };

  router.get(
    "/kb/data",
    async (req, res) => {
      const parsed = DataQuery.safeParse(req.query);
      if (!parsed.success) throw new HttpError("Parametri non validi.");
      res.json(await dataAgent.dataset(parsed.data));
    },
  );

  router.patch(
    "/kb/data/rows/:rowId",
    async (req, res) => {
      const parsed = CellUpdate.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Richiesta non valida." });
      const change = await dataAgent.updateCell(req.params.rowId, parsed.data.column, parsed.data.value);
      refreshCleaning();
      res.json(change);
    },
  );

  router.get("/kb/dictionary", async (_req, res) => res.json(await dataAgent.dictionary()));

  router.put(
    "/kb/dictionary",
    async (req, res) => {
      const parsed = DocContent.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Contenuto non valido." });
      await dataAgent.updateDictionary(parsed.data.content);
      refreshCleaning(); // regole cambiate: il data agent rigenera la pulizia con l'LLM
      res.json({ ok: true });
    },
  );

  router.get(
    "/kb/cleaning",
    async (_req, res) => {
      res.json({ ...(await dataAgent.cleaning()), queued: Boolean(pendingRefresh) });
    },
  );

  router.post(
    "/kb/cleaning/rebuild",
    async (req, res) => {
      const mode = req.body?.mode === "regenerate" ? "regenerate" : "refresh";
      res.status(202).json(await dataAgent.rebuildCleaning(mode, settings.dataAgentOverride()));
    },
  );

  return router;
}
