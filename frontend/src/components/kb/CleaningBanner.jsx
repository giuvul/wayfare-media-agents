import { describeSource } from "./useCleaningStatus.js";

export default function CleaningBanner({ cleaning, changed }) {
  if (!cleaning.status || !changed) return null;
  if (cleaning.busy) {
    return (
      <p className="notice notice-info">
        <span className="spinner spinner-sm" /> Modifica salvata. Aggiornamento della pulizia in corso: le analisi usano i dati precedenti fino al termine.
      </p>
    );
  }
  if (cleaning.status.error) return <p className="notice notice-error">Pulizia non aggiornata: {cleaning.status.error}</p>;
  return <p className="notice notice-ok">Pulizia aggiornata ({describeSource(cleaning.status.fonte)}). L'agente usa già i nuovi dati.</p>;
}
