// Applicazione Express: chat (JSON o SSE), cronologia, impostazioni, knowledge base, grafici e health check;
// su /internal/llm il proxy verso OpenRouter per il data agent.
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { clientErrorMessage, userFacingError } from "./errors.js";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { embeddingsRouter } from "./routes/embeddings.js";
import { kbRouter } from "./routes/kb.js";
import { generationsRouter } from "./routes/generations.js";
import { llmProxyRouter } from "./routes/llmProxy.js";
import { settingsRouter } from "./routes/settings.js";

const CHART_ID = /^[0-9a-f]{32}$/;

/**
 * @param {{ config: any, log: import("pino").Logger, getAgent: () => any, checkpointer: any, dataAgent: any,
 *   retriever: any, conversations: any, settings: any, documents: any, indexer: any, embeddings: any,
 *   embeddingSwitcher: any, llmFetch?: typeof fetch }} deps llmFetch: fetch verso OpenRouter del proxy (sostituibile nei test)
 */
export function createApp(deps) {
  const { config, log, dataAgent, retriever, settings } = deps;
  const app = express();
  const activeSessions = new Set(); // un turno alla volta per conversazione: la memoria non va scritta in parallelo

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_ORIGIN }));
  app.use(pinoHttp({
    logger: log,
    autoLogging: { ignore: (req) => req.url === "/api/health" || req.url.startsWith("/api/charts/") || req.url === "/internal/llm/health" },
  }));
  // limite generale per tutte le API (la chat ha un limite più stretto, definito nel suo router)
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false }));

  app.use("/api", chatRouter({ ...deps, activeSessions }));
  app.use("/api", conversationsRouter({ ...deps, activeSessions }));
  app.use("/api", settingsRouter(deps));
  app.use("/api", generationsRouter(deps));
  app.use("/api", kbRouter(deps));
  app.use("/api", embeddingsRouter(deps));
  // chiamate al modello del data agent: la chiave resta nel back end (vedi routes/llmProxy.js)
  app.use("/internal/llm", llmProxyRouter({ ...deps, fetchImpl: deps.llmFetch }));

  app.get(
    "/api/charts/:chartId",
    async (req, res) => {
      if (!CHART_ID.test(req.params.chartId)) return res.status(400).json({ error: "Identificativo grafico non valido." });
      const upstream = await dataAgent.chart(req.params.chartId);
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Grafico non disponibile." });
      res.set({ "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
      res.send(Buffer.from(await upstream.arrayBuffer()));
    },
  );

  app.get("/api/health", async (_req, res) => {
    const [kb, data] = await Promise.allSettled([retriever.status(), dataAgent.health()]);
    const knowledgeBase = kb.status === "fulfilled"
      ? { ok: kb.value.chunks > 0, ...kb.value }
      : { ok: false, error: "knowledge base non indicizzata o Chroma non raggiungibile" };
    const dataAgentStatus = data.status === "fulfilled"
      ? { ok: data.value.status === "ready", ...data.value }
      : { ok: false, error: "data agent non raggiungibile" };
    delete dataAgentStatus.model; // il modello in uso è quello delle impostazioni, indicato sotto
    const ok = knowledgeBase.ok && dataAgentStatus.ok;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      model: settings.get().model,
      knowledgeBase,
      dataAgent: dataAgentStatus,
    });
  });

  app.use((_req, res) => res.status(404).json({ error: "Risorsa non trovata." }));
  app.use((err, req, res, _next) => {
    const status = err.type === "entity.too.large" ? 413 : err.status ?? 500;
    if (status >= 500) (req.log ?? log).error({ err }, "errore non gestito");
    else (req.log ?? log).info({ err: err.message, status }, "richiesta rifiutata");
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status >= 500 ? userFacingError(err) : clientErrorMessage(err) });
  });
  return app;
}
