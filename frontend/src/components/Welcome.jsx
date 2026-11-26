import heroDark1100 from "../assets/hero-dark-1100.webp";
import heroDark2172 from "../assets/hero-dark-2172.webp";
import heroLight1100 from "../assets/hero-light-1100.webp";
import heroLight2172 from "../assets/hero-light-2172.webp";
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
    hint: "numeri, andamenti e grafici",
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

/** Banner del brand (docs/brand/Banner-Hero*.png), con la variante per il tema scuro. */
function Hero() {
  const sizes = "(max-width: 860px) 100vw, 860px";
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={`${heroDark1100} 1100w, ${heroDark2172} 2172w`} sizes={sizes} />
      <img className="hero" src={heroLight1100} srcSet={`${heroLight1100} 1100w, ${heroLight2172} 2172w`} sizes={sizes}
        width="2172" height="650" alt="" />
    </picture>
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
