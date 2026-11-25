import { Fragment, useState } from "react";

import { formatCell } from "../../format.js";
import { IconChevron } from "../Icons.jsx";

const LEVELS = {
  correggere: { label: "Da correggere", tone: "bad" },
  gestire: { label: "Da trattare come da regola", tone: "warn" },
  info: { label: "Informativo", tone: "muted" },
};

// le virgolette basse rendono visibili gli spazi iniziali e finali (es. «MXP »)
const show = (v) => (v == null ? "vuoto" : typeof v === "string" ? (v === "" ? "stringa vuota" : `«${v}»`) : String(v));

function Details({ check }) {
  return (
    <div className="quality-details">
      {check.dettaglio.length > 0 && (
        <table className="mini-table">
          <thead><tr><th>Valore trovato</th><th className="num">Righe</th><th>Valore canonico proposto</th></tr></thead>
          <tbody>
            {check.dettaglio.map((d) => (
              <tr key={d.valore}><td><code>{show(d.valore)}</code></td><td className="num">{formatCell(d.righe)}</td><td>{d.proposta ?? <span className="text-bad">nessuna corrispondenza</span>}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Esempi: {check.esempi.map((e, i) => (
          <Fragment key={i}>{i > 0 && " · "}<code>{e.id_riga}</code>{check.colonna && <> = {show(e.valore)}</>}</Fragment>
        ))}
        {check.regola && <> · regola {check.regola} del dizionario</>}
      </p>
    </div>
  );
}

/** Analisi deterministica della qualità: cosa c'è nel file grezzo e cosa resta dopo la pulizia. */
export default function QualityTable({ quality }) {
  const [open, setOpen] = useState(null);
  if (!quality?.grezzo) return null;
  const { grezzo, residui } = quality;
  return (
    <section className="card quality">
      <div className="card-toolbar">
        <div>
          <h2 className="card-title">Analisi della qualità</h2>
          <span className="muted small">
            Controlli deterministici, senza AI, su tutte le {formatCell(grezzo.righe_analizzate)} righe (una per id_riga):
            {" "}{grezzo.controlli_eseguiti} controlli, {grezzo.anomalie.length} tipi di anomalia trovati. Le regole vengono dal dizionario dati.
          </span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th /><th>Controllo</th><th>Colonna</th><th className="num">Righe nel grezzo</th><th className="num">Dopo la pulizia</th><th>Tipo</th></tr>
          </thead>
          <tbody>
            {grezzo.anomalie.map((c) => {
              const left = residui?.[c.id] ?? 0;
              const isOpen = open === c.id;
              return (
                <Fragment key={c.id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                    <td className="chev-cell"><IconChevron size={13} className={isOpen ? "rot" : ""} /></td>
                    <td className="wrap">{c.controllo}</td>
                    <td><code>{c.colonna ?? "—"}</code></td>
                    <td className="num">{formatCell(c.righe)}</td>
                    <td className="num">
                      {left === 0 ? <span className="badge badge-ok">0</span> : <span className={`badge ${c.bloccante ? "badge-bad" : "badge-muted"}`}>{formatCell(left)}</span>}
                    </td>
                    <td><span className={`level level-${LEVELS[c.livello].tone}`}>{LEVELS[c.livello].label}</span></td>
                  </tr>
                  {isOpen && <tr className="details-row"><td /><td colSpan={5}><Details check={c} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note pad-x">
        Le anomalie da correggere o trattare devono scendere a zero: se il codice di pulizia ne ignora anche una sola riga,
        la pulizia viene rifiutata e rigenerata. Restano solo i valori mancanti che il dizionario chiede di lasciare vuoti
        (es. impression non registrate: righe escluse dai KPI).
      </p>
    </section>
  );
}
