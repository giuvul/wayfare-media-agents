// Tool dati: delega l'analisi al microservizio Python (data agent). Il modello riceve solo la sintesi;
// grafici, tabella, codice e report di pulizia viaggiano come artifact verso l'interfaccia.
import { tool } from "langchain";
import { z } from "zod";
import { REASON_FIELD } from "./reason.js";

export const DATA_TOOL_NAME = "analizza_dati";

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
    /** @param {{ signal?: AbortSignal, llm?: { model?: string, api_key?: string } }} [opts] */
    analyze: (task, { signal, llm } = {}) =>
      call("/analyze", { method: "POST", body: { task, ...llm }, timeoutMs: config.DATA_AGENT_TIMEOUT_MS, signal }),
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
  ].join("");
}

/** @param {() => object} [getLlmOverride] modello e chiave scelti dall'utente nelle impostazioni */
export function createDataAgentTool(client, getLlmOverride = () => ({})) {
  return tool(
    async ({ task }, runConfig) => {
      try {
        const result = await client.analyze(task, { signal: runConfig?.signal, llm: getLlmOverride() });
        const { answer, charts, table, code, cleaning, steps, duration_ms: durationMs, error } = result;
        return [formatAnalysis(result), { task, answer, charts, table, code, cleaning, steps, durationMs, error }];
      } catch (err) {
        const message = err.name === "TimeoutError" ? "il data agent non ha risposto in tempo" : err.message;
        return [`ERRORE: ${message}. Spiega all'utente che l'analisi dei dati non è disponibile in questo momento.`, { task, error: message }];
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
