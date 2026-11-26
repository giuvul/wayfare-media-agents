// Modello di embedding: stato, catalogo OpenRouter, modelli locali con valutazione della macchina, cambio.
import express from "express";
import { z } from "zod";

import { searchModels } from "../settings.js";

const SwitchRequest = z
  .object({ provider: z.enum(["openrouter", "local"]), model: z.string().trim().min(1).max(200).regex(/^[\w.:/~-]+$/) })
  .strict();

export function embeddingsRouter({ embeddings, embeddingSwitcher, indexer }) {
  const router = express.Router();
  router.use(express.json({ limit: "2kb" }));

  router.get("/embeddings", (_req, res) => {
    res.json({ current: embeddings.current(), default: embeddings.defaults, job: embeddingSwitcher.state() });
  });

  router.get(
    "/embeddings/remote",
    async (req, res) => {
      const all = await embeddings.listRemote();
      res.json({ total: all.length, models: searchModels(all, String(req.query.q ?? "").slice(0, 100)) });
    },
  );

  router.get(
    "/embeddings/local",
    async (_req, res) => {
      const counts = await indexer.counts().catch(() => ({}));
      const chunks = Object.values(counts).reduce((s, n) => s + n, 0) || 40;
      res.json(embeddings.localCatalog(chunks));
    },
  );

  router.get("/embeddings/switch", (_req, res) => res.json(embeddingSwitcher.state()));

  router.post(
    "/embeddings/switch",
    async (req, res) => {
      const parsed = SwitchRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Richiesta non valida." });
      res.status(202).json(await embeddingSwitcher.start(parsed.data)); // errori (409, 400) dal gestore globale
    },
  );

  return router;
}
