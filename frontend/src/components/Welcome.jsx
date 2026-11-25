const GROUPS = [
  {
    title: "Regole e procedure",
    hint: "risposte dall'handbook, con le fonti",
    questions: [
      "Quali penali si applicano se un cliente cancella una campagna 10 giorni prima dell'inizio?",
      "Posso pubblicizzare un vino sui Gate Screen?",
      "La reach si può sommare tra aeroporti diversi?",
    ],
  },
  {
    title: "Analisi dei dati",
    hint: "numeri, andamenti e grafici sulle campagne",
    questions: [
      "Mostrami l'andamento mensile delle impression erogate a Roma Fiumicino nel 2026",
      "Qual è il CPM effettivo per formato? Fammi un grafico.",
      "Quali sono i 10 inserzionisti con la spesa più alta?",
    ],
  },
  {
    title: "Regole applicate ai dati",
    hint: "prima la regola, poi il calcolo",
    questions: [
      "Quanto vale in totale il make-good dovuto ai clienti?",
      "Ci sono contratti con sconti fuori policy? Quali?",
      "Perché Venezia ha erogato meno del previsto a inizio 2026?",
    ],
  },
];

export default function Welcome({ onPick }) {
  return (
    <section className="welcome">
      <h1>Come posso aiutarti?</h1>
      <p className="welcome-lead">
        Rispondo sulle regole commerciali e operative di Wayfare Media e analizzo i dati delle campagne
        (gennaio 2025 – settembre 2026) negli otto aeroporti della rete.
      </p>
      <div className="suggestions">
        {GROUPS.map((group) => (
          <div key={group.title} className="suggestion-group">
            <h2>{group.title}</h2>
            <p>{group.hint}</p>
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
