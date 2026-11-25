// Cronologia delle conversazioni (salvata sul server): elenco, dettaglio, eliminazione.
import express from "express";
import { z } from "zod";

import { asyncRoute } from "../errors.js";

const Id = z.uuid();

export function conversationsRouter({ conversations, checkpointer, dataAgent, activeSessions, log }) {
  const router = express.Router();

  router.get("/conversations", (_req, res) => res.json({ conversations: conversations.list() }));

  router.get("/conversations/:id", (req, res) => {
    if (!Id.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificativo non valido." });
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversazione non trovata." });
    res.json({ ...conversation, messages: conversations.messages(req.params.id) });
  });

  router.delete(
    "/conversations/:id",
    asyncRoute(async (req, res) => {
      const { id } = req.params;
      if (!Id.safeParse(id).success) return res.status(400).json({ error: "Identificativo non valido." });
      if (activeSessions.has(id)) return res.status(409).json({ error: "Attendi la fine della risposta in corso." });
      const charts = conversations
        .messages(id)
        .flatMap((m) => m.steps ?? [])
        .flatMap((s) => s.artifact?.charts ?? []);
      if (!conversations.remove(id)) return res.status(404).json({ error: "Conversazione non trovata." });
      await checkpointer.deleteThread(id); // anche la memoria dell'agente viene cancellata
      // i grafici generati non servono più (operazione non bloccante: un errore non annulla l'eliminazione)
      await Promise.allSettled(charts.map((c) => dataAgent.deleteChart(c))).then((r) => {
        const failed = r.filter((x) => x.status === "rejected").length;
        if (failed) log.warn({ conversation: id, failed }, "alcuni grafici non sono stati eliminati");
      });
      res.status(204).end();
    }),
  );

  return router;
}
