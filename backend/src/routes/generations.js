// GET /api/generations?ids=gen-a,gen-b: modello, provider e costo effettivi delle chiamate al modello di un turno.
// La chiave OpenRouter resta sul server; gli id non ancora disponibili tornano come null (il client riprova).
import express from "express";
import rateLimit from "express-rate-limit";

import { asyncRoute } from "../errors.js";
import { GENERATION_ID } from "../generations.js";

export function generationsRouter({ generations }) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

  router.get(
    "/generations",
    limiter,
    asyncRoute(async (req, res) => {
      const ids = [...new Set(String(req.query.ids ?? "").split(",").filter(Boolean))];
      if (ids.length === 0 || ids.length > 30 || !ids.every((id) => GENERATION_ID.test(id))) {
        return res.status(400).json({ error: "Id di generazione non validi." });
      }
      res.json({ generations: await generations.lookup(ids) });
    }),
  );

  return router;
}
