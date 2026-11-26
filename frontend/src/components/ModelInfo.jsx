import { useEffect, useMemo, useState } from "react";

import { api } from "../api.js";
import { generationIds, ROLE_LABEL, summarizeGenerations } from "../generations.js";

// OpenRouter rende disponibili i dettagli di una generazione qualche secondo dopo la risposta
const RETRY_MS = 4_000;
const MAX_ATTEMPTS = 15;

const short = (model) => model.split("/").pop();
const usd = (n) => `${n.toLocaleString("it-IT", { maximumFractionDigits: n < 0.01 ? 4 : 2 })} $`;

/** Modello che ha risposto davvero (orchestratore e analista dati), con provider e costo del turno. */
export default function ModelInfo({ generations, requested }) {
  const ids = useMemo(() => generationIds(generations), [generations]);
  const [details, setDetails] = useState({});
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (ids.length === 0) return undefined;
    const controller = new AbortController();
    let timer;
    let attempts = 0;
    const known = {};
    const poll = async () => {
      attempts++;
      try {
        const missing = ids.filter((id) => !known[id]);
        const { generations: found } = await api.generations(missing, controller.signal);
        for (const [id, d] of Object.entries(found)) if (d) known[id] = d;
        setDetails({ ...known });
      } catch {
        if (controller.signal.aborted) return;
      }
      if (ids.some((id) => !known[id])) {
        if (attempts < MAX_ATTEMPTS) timer = setTimeout(poll, RETRY_MS);
        else setGaveUp(true);
      }
    };
    timer = setTimeout(poll, 1_000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ids]);

  if (ids.length === 0) return null;
  const { pending, roles, costUsd } = summarizeGenerations(generations, details, requested);
  if (roles.length === 0) {
    return <p className="served-model">{gaveUp ? "Modello effettivo non disponibile" : "Verifica del modello effettivo…"}</p>;
  }

  const fallback = roles.flatMap((r) => r.models.filter((m) => m.fallback).map((m) => ({ ...m, role: r.role })));
  // un solo modello per tutto il turno: una riga; altrimenti un modello per ruolo
  const allModels = [...new Set(roles.flatMap((r) => r.models.map((m) => m.model)))];
  const describe = (m) => `${short(m.model)}${m.providers.length ? ` (${m.providers.join(", ")})` : ""}`;
  const parts =
    allModels.length === 1
      ? [`Modello: ${describe({ model: allModels[0], providers: [...new Set(roles.flatMap((r) => r.models.flatMap((m) => m.providers)))] })}`]
      : roles.map((r) => `${ROLE_LABEL[r.role] ?? r.role}: ${r.models.map(describe).join(", ")}`);

  return (
    <div className="served-model" title="Dati di OpenRouter sulle chiamate al modello di questa risposta">
      <span>{parts.join(" · ")}</span>
      {costUsd > 0 && <span>· {usd(costUsd)}</span>}
      {pending > 0 && !gaveUp && <span>· verifica in corso…</span>}
      {fallback.length > 0 && (
        <span className="badge badge-warn">
          {requested ? `Modello di riserva al posto di ${short(requested)}` : "Modello di riserva"}
        </span>
      )}
    </div>
  );
}
