// Applicazione Express: API della chat (JSON o streaming SSE), proxy dei grafici e health check aggregato.
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { z } from "zod";

import { runTurn } from "./agent.js";

const ChatRequest = z.object({
  message: z.string().trim().min(1, "Il messaggio è vuoto.").max(2000, "Il messaggio supera i 2000 caratteri."),
  sessionId: z.uuid("sessionId deve essere un UUID."),
});
const CHART_ID = /^[0-9a-f]{32}$/;

function userFacingError(err) {
  if (err.name === "AbortError" || err.name === "TimeoutError") return "La richiesta ha impiegato troppo tempo. Riprova o semplifica la domanda.";
  if (/429|rate.?limit/i.test(err.message)) return "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo.";
  return "Si è verificato un errore durante l'elaborazione. Riprova tra poco.";
}

/**
 * @param {{ config: any, log: import("pino").Logger, agent: any, checkpointer: any, dataAgent: any, retriever: any }} deps
 */
export function createApp({ config, log, agent, checkpointer, dataAgent, retriever }) {
  const app = express();
  const activeSessions = new Set(); // un turno alla volta per sessione: la memoria non va scritta in parallelo

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_ORIGIN }));
  app.use(express.json({ limit: "16kb" }));
  app.use(pinoHttp({ logger: log, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.CHAT_RATE_LIMIT_PER_MIN,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Troppe richieste: attendi un minuto prima di riprovare." },
  });

  app.post("/api/chat", chatLimiter, async (req, res, next) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { message, sessionId } = parsed.data;
    if (activeSessions.has(sessionId)) {
      return res.status(409).json({ error: "C'è già una risposta in corso per questa conversazione." });
    }
    activeSessions.add(sessionId);

    const clientGone = new AbortController();
    res.on("close", () => !res.writableFinished && clientGone.abort());
    const signal = AbortSignal.any([clientGone.signal, AbortSignal.timeout(config.CHAT_TIMEOUT_MS)]);
    const wantsStream = req.accepts(["application/json", "text/event-stream"]) === "text/event-stream";

    try {
      if (!wantsStream) {
        const result = await runTurn({ agent, checkpointer, sessionId, message, signal });
        return res.json(result);
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // niente buffering dei proxy: gli eventi arrivano subito
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      send("status", { stage: "thinking" });
      try {
        await runTurn({ agent, checkpointer, sessionId, message, signal, onEvent: send });
      } catch (err) {
        req.log.error({ err }, "turno di chat fallito");
        send("error", { message: userFacingError(err) });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    } catch (err) {
      next(err);
    } finally {
      activeSessions.delete(sessionId);
    }
  });

  app.get("/api/charts/:chartId", async (req, res, next) => {
    try {
      if (!CHART_ID.test(req.params.chartId)) return res.status(400).json({ error: "Identificativo grafico non valido." });
      const upstream = await dataAgent.chart(req.params.chartId);
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Grafico non disponibile." });
      res.set({ "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/health", async (_req, res) => {
    const [kb, data] = await Promise.allSettled([retriever.status(), dataAgent.health()]);
    const knowledgeBase = kb.status === "fulfilled"
      ? { ok: kb.value.chunks > 0, ...kb.value }
      : { ok: false, error: kb.reason.message };
    const dataAgentStatus = data.status === "fulfilled"
      ? { ok: data.value.status === "ready", ...data.value }
      : { ok: false, error: "data agent non raggiungibile" };
    const ok = knowledgeBase.ok && dataAgentStatus.ok;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      model: config.LLM_MODEL,
      knowledgeBase,
      dataAgent: dataAgentStatus,
    });
  });

  app.use((_req, res) => res.status(404).json({ error: "Risorsa non trovata." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    (req.log ?? log).error({ err }, "errore non gestito");
    if (res.headersSent) return res.end();
    const status = err.type === "entity.too.large" ? 413 : err.status ?? 500;
    res.status(status).json({ error: status === 500 ? userFacingError(err) : err.message });
  });
  return app;
}
