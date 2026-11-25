// POST /api/chat: un turno di conversazione, in JSON o in streaming SSE. Domanda e risposta vengono salvate.
import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { runTurn } from "../agent.js";
import { userFacingError } from "../errors.js";

const ChatRequest = z.object({
  message: z.string().trim().min(1, "Il messaggio è vuoto.").max(2000, "Il messaggio supera i 2000 caratteri."),
  sessionId: z.uuid("sessionId deve essere un UUID."),
});

export function chatRouter({ config, getAgent, checkpointer, conversations, activeSessions }) {
  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.CHAT_RATE_LIMIT_PER_MIN,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Troppe richieste: attendi un minuto prima di riprovare." },
  });

  router.post("/chat", limiter, async (req, res) => {
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

    const conversation = conversations.ensure(sessionId, message);
    conversations.addMessage(sessionId, { id: randomUUID(), role: "user", text: message });
    const started = Date.now();
    const assistant = { id: randomUUID(), role: "assistant", text: "", steps: [], status: "done" };
    // gli step arrivati prima di un errore restano visibili anche nella cronologia
    const partial = new Map();
    const track = (event, data) => {
      if (event === "tool_start" || event === "tool_end") partial.set(data.id, { ...partial.get(data.id), ...data });
    };

    let send = () => {};
    let heartbeat = null;
    if (wantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // niente buffering dei proxy: gli eventi arrivano subito
      });
      send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      send("status", { stage: "thinking", conversation });
    }

    try {
      const result = await runTurn({
        agent: getAgent(),
        checkpointer,
        sessionId,
        message,
        signal,
        deadline: started + config.CHAT_TIMEOUT_MS,
        onEvent: (event, data) => {
          track(event, data);
          send(event, data);
        },
      });
      Object.assign(assistant, { text: result.answer, steps: result.steps });
    } catch (err) {
      const stopped = clientGone.signal.aborted;
      Object.assign(assistant, {
        steps: [...partial.values()],
        status: stopped ? "stopped" : "error",
        error: stopped ? "Risposta interrotta." : userFacingError(err),
      });
      if (!stopped) req.log.error({ err }, "turno di chat fallito");
      send("error", { message: assistant.error });
    } finally {
      assistant.durationMs = Date.now() - started;
      conversations.addMessage(sessionId, assistant);
      activeSessions.delete(sessionId);
      clearInterval(heartbeat);
    }

    if (wantsStream) return res.end();
    if (assistant.status === "error") return res.status(500).json({ error: assistant.error });
    return res.json({ answer: assistant.text, steps: assistant.steps, conversation });
  });

  return router;
}
