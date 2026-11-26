// Tool dati: delega l'analisi al microservizio Python (data agent). Il modello riceve solo la sintesi;
// grafici, tabella, codice e report di pulizia viaggiano come artifact verso l'interfaccia.
import { tool } from "langchain";
import { z } from "zod";
import { REASON_FIELD } from "./reason.js";

export const DATA_TOOL_NAME = "analizza_dati";

// Scadenza del turno: l'analista riceve il tempo che resta, meno una riserva per la risposta finale dell'orchestratore
// e il margine con cui la richiesta HTTP attende la sua conclusione (risposta con i risultati parziali).
// Sotto il minimo non si avvia un'analisi che non potrebbe concludersi: il modello risponde con ciò che ha già.
export const FINAL_ANSWER_RESERVE_MS = 20_000;
export const ANALYSIS_GRACE_MS = 15_000;
export const MIN_ANALYSIS_MS = 20_000;
const MAX_ANALYSIS_MS = 60_000;

export function createDataAgentClient(config, fetchImpl = fetch) {
  const headers = { "X-Internal-Token": config.DATA_AGENT_TOKEN };
  const call = async (pathname, { method = "GET", body, query, timeoutMs = 15_000, signal } = {}) => {
    const url = new URL(pathname, config.DATA_AGENT_URL);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, {
      method,
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const detail = await res.json().then((b) => (typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail))).catch(() => res.statusText);
      const err = new Error(`data agent HTTP ${res.status}: ${detail}`);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  };

  return {
    /** @param {{ signal?: AbortSignal, llm?: { model?: string }, budgetMs?: number }} [opts] budgetMs: tempo concesso all'analisi */
    analyze: (task, { signal, llm, budgetMs } = {}) =>
      call("/analyze", {
        method: "POST",
        body: { task, ...llm, ...(budgetMs ? { timeout_s: Math.max(5, Math.floor(budgetMs / 1000)) } : {}) },
        // dopo la scadenza l'analista scrive ancora la risposta finale con i risultati parziali
        timeoutMs: budgetMs ? Math.min(config.DATA_AGENT_TIMEOUT_MS, budgetMs + ANALYSIS_GRACE_MS) : config.DATA_AGENT_TIMEOUT_MS,
        signal,
      }),
    chart: (chartId) => fetchImpl(new URL(`/charts/${chartId}`, config.DATA_AGENT_URL), { headers, signal: AbortSignal.timeout(10_000) }),
    deleteChart: (chartId) => call(`/charts/${chartId}`, { method: "DELETE" }),
    health: async () => {
      const res = await fetchImpl(new URL("/health", config.DATA_AGENT_URL), { signal: AbortSignal.timeout(3_000) });
      return res.json();
    },
    dataset: (query) => call("/dataset", { query, timeoutMs: 30_000 }),
    updateCell: (rowId, column, value) =>
      call(`/dataset/rows/${encodeURIComponent(rowId)}`, { method: "PATCH", body: { column, value } }),
    dictionary: () => call("/dictionary"),
    updateDictionary: (content) => call("/dictionary", { method: "PUT", body: { content } }),
    cleaning: () => call("/cleaning"),
    rebuildCleaning: (mode, llm) => call("/cleaning/rebuild", { method: "POST", body: { mode, ...llm } }),
  };
}

export function formatAnalysis(result) {
  if (result.error && !result.answer) return `ERRORE: l'analisi non è riuscita (${result.error}).`;
  const extras = [];
  if (result.charts?.length) extras.push(`${result.charts.length} grafico/i`);
  if (result.table) extras.push("una tabella dei risultati");
  return [
    result.answer,
    extras.length ? `\n[Mostrati all'utente sotto la risposta: ${extras.join(" e ")}. Non ripeterli.]` : "",
    result.error ? `\n[Avviso: ${result.error}]` : "",
    result.completa === false
      ? "\n[Analisi interrotta per limite di passi o di tempo: NON ripeterla. Rispondi con i risultati ottenuti e indica cosa manca.]"
      : "",
  ].join("");
}

/** Messaggio mostrato all'utente: i dettagli del data agent (già in italiano) sì, quelli tecnici no. */
export function analysisErrorMessage(err) {
  if (err.name === "TimeoutError") return "il data agent non ha risposto in tempo";
  if (err.status && typeof err.detail === "string" && err.detail.length < 300) return err.detail;
  return "l'analista dati non è raggiungibile";
}

/** @param {() => object} [getLlmOverride] modello scelto dall'utente nelle impostazioni */
export function createDataAgentTool(client, getLlmOverride = () => ({})) {
  return tool(
    async ({ task }, runConfig) => {
      const deadline = runConfig?.configurable?.deadline;
      const budgetMs = deadline
        ? Math.min(MAX_ANALYSIS_MS, deadline - Date.now() - FINAL_ANSWER_RESERVE_MS - ANALYSIS_GRACE_MS)
        : undefined;
      if (budgetMs !== undefined && budgetMs < MIN_ANALYSIS_MS) {
        const error = "tempo del turno quasi esaurito";
        return [`ERRORE: ${error}, non c'è tempo per una nuova analisi. Rispondi con i risultati già ottenuti e indica cosa manca; l'utente può chiedere il resto in un nuovo messaggio.`, { task, ok: false, error }];
      }
      try {
        const result = await client.analyze(task, { signal: runConfig?.signal, llm: getLlmOverride(), budgetMs });
        const { answer, charts, table, code, cleaning, steps, duration_ms: durationMs, error, generazioni = [] } = result;
        const ok = Boolean(answer) || !error;
        return [formatAnalysis(result), { task, ok, answer, charts, table, code, cleaning, steps, durationMs, error, generations: generazioni }];
      } catch (err) {
        const message = analysisErrorMessage(err);
        return [`ERRORE: ${message}. Spiega all'utente che l'analisi dei dati non è disponibile in questo momento.`, { task, ok: false, error: message }];
      }
    },
    {
      name: DATA_TOOL_NAME,
      description:
        "Delega a un analista dati (agente Python con pandas) l'analisi del dataset delle campagne Wayfare Media " +
        "(gen 2025 - set 2026: impression pianificate/erogate, reach, dwell, scansioni QR, conversioni, CPM, spesa, " +
        "per campagna, inserzionista, settore, aeroporto, formato, segmento, data). Pulisce i dati, calcola KPI, trend " +
        "e classifiche e genera grafici. Usalo per qualsiasi domanda che richieda NUMERI sui dati.",
      schema: z.object({
        motivo: REASON_FIELD,
        task: z
          .string()
          .min(10)
          .describe(
            "Richiesta autonoma e completa in italiano: metrica, filtri (periodo, aeroporto, formato, settore...), " +
              "raggruppamento e se serve un grafico. Risolvi i riferimenti alla conversazione ('e per Malpensa?' -> " +
              "richiesta completa) e includi le regole di business recuperate dalla documentazione.",
          ),
      }),
      responseFormat: "content_and_artifact",
    },
  );
}
