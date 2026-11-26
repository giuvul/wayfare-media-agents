// Proxy LLM per il data agent. Il servizio che esegue il codice generato dal modello non possiede la chiave
// OpenRouter: chiama questo endpoint con il token interno, e il back end aggiunge la chiave in uso (quella delle
// Impostazioni o del .env) e inoltra la richiesta. Montato su /internal/llm, fuori da /api: nginx non lo pubblica.
import { createHash, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

import express from "express";
import rateLimit from "express-rate-limit";

const UPSTREAM_TIMEOUT_MS = 180_000; // rete di sicurezza: il data agent applica già i suoi timeout per chiamata
const CATALOG_TTL_MS = 3_600_000;

/** Confronto a tempo costante anche con lunghezze diverse (si confrontano gli hash). */
export function sameSecret(a, b) {
  const digest = (s) => createHash("sha256").update(String(s)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

const openAiError = (res, status, message) => res.status(status).json({ error: { message, code: status } });

/** @param {{ config: any, settings: any, log: import("pino").Logger, fetchImpl?: typeof fetch }} deps */
export function llmProxyRouter({ config, settings, log, fetchImpl = fetch }) {
  const router = express.Router();
  let catalog = { at: 0, body: null };

  // senza token: il data agent la usa solo per sapere se il back end è già in ascolto
  router.get("/health", (_req, res) => res.json({ status: "ok" }));

  router.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
  router.use((req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!token || !sameSecret(token, config.DATA_AGENT_TOKEN)) return openAiError(res, 401, "Token interno mancante o non valido.");
    next();
  });

  // catalogo pubblico dei modelli (serve al data agent per sapere quali accettano la temperatura)
  router.get("/models", async (_req, res) => {
    if (!catalog.body || Date.now() - catalog.at > CATALOG_TTL_MS) {
      try {
        const upstream = await fetchImpl(`${config.OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(15_000) });
        if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
        catalog = { at: Date.now(), body: await upstream.json() };
      } catch (err) {
        log.warn({ err: err.message }, "proxy LLM: catalogo modelli non disponibile");
        return openAiError(res, 502, "Catalogo modelli non disponibile.");
      }
    }
    res.json(catalog.body);
  });

  router.post("/chat/completions", express.json({ limit: "5mb" }), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.model !== "string" || !Array.isArray(body.messages)) {
      return openAiError(res, 400, "Richiesta non valida.");
    }
    // se il data agent smette di aspettare (timeout, Stop dell'utente) si interrompe anche la chiamata a valle
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });
    let upstream;
    try {
      upstream = await fetchImpl(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.get().apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Wayfare Media Agents",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      log.warn({ err: err.message }, "proxy LLM: OpenRouter non raggiungibile");
      return openAiError(res, 502, "OpenRouter non raggiungibile.");
    }
    // stato e corpo inoltrati così come sono (anche gli errori 401/402/429 di OpenRouter, che il data agent gestisce)
    res.status(upstream.status);
    res.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body)
      .on("error", (err) => {
        if (!abort.signal.aborted) log.warn({ err: err.message }, "proxy LLM: risposta interrotta");
        res.destroy();
      })
      .pipe(res);
  });

  return router;
}
