// Modello che ha risposto davvero, dagli id delle generazioni OpenRouter del turno (vedi backend/src/generations.js).

export const ROLE_LABEL = { orchestratore: "Orchestratore", analista: "Analista dati" };

/** true se il modello servito è quello scelto (OpenRouter può aggiungere la versione: "...-20260910"). */
export const sameModel = (served, requested) => served === requested || served.startsWith(`${requested}-`);

export const generationIds = (generations) => [...new Set(Object.values(generations ?? {}).flat())];

/**
 * Riassume i dettagli delle generazioni per ruolo.
 * @returns {{ pending: number, roles: { role: string, models: { model: string, providers: string[], fallback: boolean }[] }[], costUsd: number }}
 */
export function summarizeGenerations(generations, details, requested) {
  let pending = 0;
  let costUsd = 0;
  const roles = [];
  for (const [role, ids] of Object.entries(generations ?? {})) {
    const byModel = new Map();
    for (const id of ids) {
      const d = details[id];
      if (!d) {
        pending++;
        continue;
      }
      costUsd += d.costUsd ?? 0;
      // un modello con il suffisso di versione viene mostrato con il nome scelto nelle Impostazioni
      const fallback = requested ? !sameModel(d.model, requested) : false;
      const model = requested && !fallback ? requested : d.model;
      const entry = byModel.get(model) ?? { model, providers: [], fallback };
      if (d.provider && !entry.providers.includes(d.provider)) entry.providers.push(d.provider);
      byModel.set(model, entry);
    }
    if (byModel.size) roles.push({ role, models: [...byModel.values()] });
  }
  return { pending, roles, costUsd };
}
