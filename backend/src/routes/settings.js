// Impostazioni: chiave API OpenRouter e modello, con ricerca nel catalogo modelli di OpenRouter.
import express from "express";
import { z } from "zod";

import { asyncRoute } from "../errors.js";
import { searchModels } from "../settings.js";

const SettingsUpdate = z
  .object({
    apiKey: z.string().trim().min(1).max(300).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    resetApiKey: z.boolean().optional(),
    resetModel: z.boolean().optional(),
  })
  .strict();

export function settingsRouter({ settings }) {
  const router = express.Router();
  router.use(express.json({ limit: "4kb" }));

  router.get("/settings", asyncRoute(async (_req, res) => res.json(await settings.describe())));

  router.put(
    "/settings",
    asyncRoute(async (req, res) => {
      const parsed = SettingsUpdate.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Richiesta non valida." });
      res.json(await settings.update(parsed.data));
    }),
  );

  router.get(
    "/models",
    asyncRoute(async (req, res) => {
      const q = String(req.query.q ?? "").slice(0, 100);
      const all = await settings.listModels();
      res.json({ total: all.length, models: searchModels(all, q) });
    }),
  );

  return router;
}
