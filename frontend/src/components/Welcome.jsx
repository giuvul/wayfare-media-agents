import { useId } from "react";

import { IconBook, IconChart, IconDoc } from "./Icons.jsx";

const GROUPS = [
  {
    icon: IconBook,
    title: "Regole e procedure",
    hint: "risposte dall'handbook, con le fonti",
    questions: [
      "Quali penali si applicano se un cliente cancella una campagna 10 giorni prima dell'inizio?",
      "Posso pubblicizzare un vino sui Gate Screen?",
      "La reach si può sommare tra aeroporti diversi?",
    ],
  },
  {
    icon: IconChart,
    title: "Analisi dei dati",
    hint: "numeri, andamenti e grafici sulle campagne",
    questions: [
      "Mostrami l'andamento mensile delle impression erogate a Roma Fiumicino nel 2026",
      "Qual è il CPM effettivo per formato? Fammi un grafico.",
      "Quali sono i 10 inserzionisti con la spesa più alta?",
    ],
  },
  {
    icon: IconDoc,
    title: "Regole applicate ai dati",
    hint: "prima la regola, poi il calcolo",
    questions: [
      "Quanto vale in totale il make-good dovuto ai clienti?",
      "Ci sono contratti con sconti fuori policy? Quali?",
      "Perché Venezia ha erogato meno del previsto a inizio 2026?",
    ],
  },
];

const fill = (token) => ({ fill: `var(--illus-${token})` });

/** Illustrazione in stile modernista (forme piatte): terminal, sole, pista e torre di controllo. */
function Hero() {
  const clip = useId();
  const body = "M190 168V128Q372 74 566 116V168z";
  return (
    <svg className="hero" viewBox="0 0 880 230" aria-hidden="true">
      <circle cx="652" cy="104" r="76" style={fill("sun")} />
      <rect x="0" y="168" width="880" height="28" style={fill("band")} />
      <rect x="0" y="196" width="880" height="34" style={fill("ground")} />
      <path d="M0 230V150a80 80 0 0 1 80 80z" style={fill("olive")} />
      <path d="M880 230v-62a62 62 0 0 0-62 62z" style={fill("sun")} />
      {/* terminal: corpo vetrato sotto una copertura curva */}
      <clipPath id={clip}><path d={body} /></clipPath>
      <path d={body} style={fill("building")} />
      {/* vetrate: montanti ritagliati sulla sagoma del terminal */}
      <g clipPath={`url(#${clip})`} style={{ stroke: "var(--illus-line)", strokeWidth: 2 }}>
        {Array.from({ length: 15 }, (_, i) => 208 + i * 25).map((x) => <line key={x} x1={x} x2={x} y1="60" y2="168" />)}
        <line x1="190" x2="566" y1="144" y2="144" />
      </g>
      <path d="M150 124Q372 62 600 108" fill="none" style={{ stroke: "var(--illus-line)", strokeWidth: 7, strokeLinecap: "round" }} />
      {/* torre di controllo */}
      <rect x="744" y="84" width="16" height="84" style={fill("line")} />
      <path d="M726 66h52l-8 18h-36z" style={fill("line")} />
      <rect x="740" y="54" width="24" height="12" style={fill("band")} />
      <rect x="751" y="38" width="2" height="16" style={fill("line")} />
    </svg>
  );
}

export default function Welcome({ onPick }) {
  return (
    <section className="welcome">
      <Hero />
      <h1>Come posso aiutarti?</h1>
      <p className="welcome-lead">
        Rispondo sulle regole commerciali e operative di Wayfare Media e analizzo i dati delle campagne
        (gennaio 2025 – settembre 2026) negli otto aeroporti della rete.
      </p>
      <div className="suggestions">
        {GROUPS.map((group) => (
          <div key={group.title} className="suggestion-group">
            <div className="suggestion-head">
              <group.icon size={22} />
              <div>
                <h2>{group.title}</h2>
                <p>{group.hint}</p>
              </div>
            </div>
            {group.questions.map((q) => (
              <button key={q} type="button" className="suggestion" onClick={() => onPick(q)}>
                {q}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
