// Tool dati: delega l'analisi al microservizio Python (data agent). Il modello riceve solo la sintesi;
// grafici, tabella, codice e report di pulizia viaggiano come artifact verso l'interfaccia.
import { tool } from "langchain";
import { z } from "zod";

export const DATA_TOOL_NAME = "analizza_dati";

export function createDataAgentClient(config, fetchImpl = fetch) {
  const headers = { "X-Internal-Token": config.DATA_AGENT_TOKEN };
  return {
    async analyze(task, { signal } = {}) {
      const timeout = AbortSignal.timeout(config.DATA_AGENT_TIMEOUT_MS);
      const res = await fetchImpl(new URL("/analyze", config.DATA_AGENT_URL), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) {
        const detail = await res.json().then((b) => b.detail).catch(() => res.statusText);
        throw new Error(`data agent HTTP ${res.status}: ${detail}`);
      }
      return res.json();
    },
    async chart(chartId) {
      return fetchImpl(new URL(`/charts/${chartId}`, config.DATA_AGENT_URL), { headers, signal: AbortSignal.timeout(10_000) });
    },
    async health() {
      const res = await fetchImpl(new URL("/health", config.DATA_AGENT_URL), { signal: AbortSignal.timeout(3_000) });
      return res.json();
    },
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

export function createDataAgentTool(client) {
  return tool(
    async ({ task }, runConfig) => {
      try {
        const result = await client.analyze(task, { signal: runConfig?.signal });
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
