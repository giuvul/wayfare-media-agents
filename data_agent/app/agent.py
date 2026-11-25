"""Agente pandas: riceve un compito di analisi, scrive ed esegue codice Python sul DataFrame pulito,
produce grafici e una sintesi narrativa per chi deve decidere.

Implementa il pattern di `create_pandas_dataframe_agent` (ReAct + interprete Python su un DataFrame)
con `create_agent` di LangChain 1.x e un interprete isolato (`sandbox.Sandbox`): il pacchetto
`langchain-experimental` che ospitava il pandas agent è stato dismesso a maggio 2026
(https://github.com/langchain-ai/langchain-experimental/issues/87).
"""

from __future__ import annotations

import io
import logging
import pickle
import time
from dataclasses import dataclass, field

import pandas as pd
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.errors import GraphRecursionError

from .cleaning import CleanedData
from .config import Settings
from .llm import build_llm
from .sandbox import Sandbox

log = logging.getLogger("data_agent.agent")

FINALIZE_PROMPT = (
    "Hai esaurito i passi o il tempo a disposizione: non eseguire altro codice. Scrivi ora la risposta finale "
    "usando SOLO i risultati già ottenuti negli output precedenti. Se il calcolo è incompleto, dillo chiaramente "
    "e indica cosa manca."
)

SYSTEM_PROMPT = """Sei il data analyst del reparto Media Sales & Campaign Performance di Wayfare Media,
concessionaria pubblicitaria digitale in otto aeroporti italiani. Rispondi in italiano.

## Strumento
Hai uno strumento, `esegui_python`, che esegue codice Python in un interprete con stato persistente
(come un notebook). Sono già disponibili:
- `df`: le righe VALIDE e già pulite dell'export campagne (base di TUTTI i KPI). {righe_valide} righe.
- `df_completo`: tutte le righe deduplicate, comprese quelle escluse dai KPI per dato di erogazione
  mancante o errato (usalo solo per domande sulla qualità dei dati).
- `pd`, `np`, `plt` (matplotlib, tema aziendale già impostato), `sns` (seaborn).
Non leggere né scrivere file: i grafici ancora aperti a fine esecuzione vengono salvati automaticamente.

## Schema di `df`
{schema}

Prime righe:
{head}

## Regole di calcolo (dal dizionario dati e dalla metodologia aziendale)
- CPM effettivo = somma(spesa_eur) / somma(impression_erogate) * 1000. Mai la media dei CPM di riga.
- Tasso di erogazione = somma(impression_erogate) / somma(impression_pianificate).
- Tasso QR = scansioni_qr / impression_erogate; tasso di conversione = conversioni / scansioni_qr.
- La reach NON è additiva: non sommarla tra giorni o aeroporti.
- Una campagna è conclusa se data_fine_flight <= {data_estrazione} (data di estrazione dei dati).
- Il compito che ricevi può contenere regole di business già recuperate dalla documentazione: applicale alla lettera.

## Come lavorare
1. Esplora quanto serve, poi calcola. Ogni numero della risposta deve venire da codice eseguito: mai stime a memoria.
2. Salva la tabella principale del risultato nella variabile `risultato` (DataFrame o Series, max ~50 righe):
   verrà mostrata all'utente accanto al grafico.
3. Se il compito chiede un grafico o un andamento, o se un grafico aiuta davvero, creane UNO con matplotlib:
   titolo ed etichette in italiano, un solo asse y (mai doppio asse), barre ordinate per valore, date leggibili.
   NON impostare colori (niente color=, cmap o palette): il tema aziendale li assegna. Una sola misura = un
   solo colore; più serie solo se ognuna è una categoria da distinguere (max 4, le altre in "Altro").
   Etichette dei valori solo dove servono, in formato italiano (es. "31,84 €", "1,2 mln").
   Non chiamare plt.show() né plt.savefig().
4. Se un'esecuzione fallisce leggi l'errore e correggi il codice.

## Risposta finale
Una sintesi per un responsabile commerciale, in 3-6 frasi: i numeri chiave (con unità e periodo),
cosa significano per il business e, se utile, un'azione consigliata. Cita le esclusioni rilevanti
(es. righe non valide o campagne ancora in corso).
- Usa SOLO numeri e attributi (settori, inserzionisti, aeroporti...) che compaiono nell'output del codice.
  Se ti serve un totale, una quota o un confronto che non hai ancora calcolato, calcolalo prima con
  `esegui_python`: mai calcoli a mente.
- Non riportare tabelle né codice: la tabella `risultato` e il grafico sono mostrati all'utente a parte.
"""

TOOL_DESCRIPTION = (
    "Esegue codice Python (pandas/numpy/matplotlib/seaborn) sul DataFrame `df` delle campagne e restituisce "
    "l'output stampato e il valore dell'ultima espressione. Lo stato delle variabili resta tra le chiamate."
)


@dataclass
class AnalysisResult:
    answer: str
    code: list[str] = field(default_factory=list)
    charts: list[str] = field(default_factory=list)
    table: dict | None = None
    steps: int = 0
    error: str | None = None
    duration_ms: int = 0


def _schema(df: pd.DataFrame) -> str:
    lines = []
    for col in df.columns:
        s = df[col]
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            extra = f"min {s.min():.4g}, max {s.max():.4g}"
        elif pd.api.types.is_datetime64_any_dtype(s):
            extra = f"dal {s.min():%Y-%m-%d} al {s.max():%Y-%m-%d}"
        else:
            values = s.dropna().unique()
            extra = "valori: " + ", ".join(map(str, values[:9])) + (" ..." if len(values) > 9 else "")
        lines.append(f"- {col} ({s.dtype}): {extra}")
    return "\n".join(lines)


def _text(message: AIMessage) -> str:
    content = message.content
    if isinstance(content, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content).strip()
    return str(content).strip()


class DataAnalyst:
    def __init__(self, settings: Settings, data: CleanedData):
        self.settings = settings
        self.data = data
        with open(data.valid_path, "rb") as fh:
            df = pickle.load(fh)
        buffer = io.StringIO()
        buffer.write(df.head(3).to_string())
        self._system_prompt = SYSTEM_PROMPT.format(
            righe_valide=len(df), schema=_schema(df), head=buffer.getvalue(),
            data_estrazione=df["data"].max().strftime("%Y-%m-%d"),
        )
        self._llm = build_llm(settings)

    def analyze(self, task: str, llm=None) -> AnalysisResult:
        llm = llm or self._llm
        started = time.monotonic()
        deadline = started + self.settings.request_timeout_s
        result = AnalysisResult(answer="")
        frames = {"df": self.data.valid_path, "df_completo": self.data.complete_path}

        with Sandbox(frames, self.settings.charts_dir, self.settings.exec_timeout_s) as box:

            def esegui_python(codice: str) -> str:
                if time.monotonic() > deadline:
                    return "Tempo a disposizione esaurito: non eseguire altro codice e scrivi la risposta finale."
                result.code.append(codice)
                out = box.run(codice)
                result.charts.extend(out.charts)
                if not out.ok:
                    return f"ERRORE\n{out.error}"
                note = f"\n[Grafico salvato ({len(out.charts)})]" if out.charts else ""
                return (out.output or "(nessun output: usa print() o metti un'espressione alla fine)") + note

            tool = StructuredTool.from_function(esegui_python, name="esegui_python", description=TOOL_DESCRIPTION)
            agent = create_agent(model=llm, tools=[tool], system_prompt=self._system_prompt)
            messages: list = []
            exhausted = False
            try:
                # stream dello stato: se i passi finiscono, il lavoro fatto fin qui non va perso
                for state in agent.stream(
                    {"messages": [{"role": "user", "content": task}]},
                    config={"recursion_limit": 2 * self.settings.max_agent_steps + 1},
                    stream_mode="values",
                ):
                    messages = state["messages"]
                    if time.monotonic() > deadline:
                        exhausted = True
                        break
            except GraphRecursionError:
                exhausted = True
            except Exception as exc:  # errori del provider LLM, rete, ecc.
                log.exception("analisi fallita")
                result.error = f"Analisi non riuscita: {type(exc).__name__}: {exc}"[:500]
            result.steps = sum(isinstance(m, ToolMessage) for m in messages)

            final = None
            if messages and isinstance(messages[-1], AIMessage) and not messages[-1].tool_calls:
                final = messages[-1]
            elif exhausted and result.steps:
                # ultima chiamata senza strumenti: il modello deve concludere con i numeri già calcolati
                log.info("passi o tempo esauriti dopo %d esecuzioni: risposta finale forzata", result.steps)
                history = list(messages)
                if isinstance(history[-1], AIMessage) and history[-1].tool_calls:
                    history.pop()  # tool call senza risposta: l'API la rifiuterebbe
                try:
                    final = llm.invoke([("system", self._system_prompt), *history,
                                              HumanMessage(FINALIZE_PROMPT)])
                except Exception as exc:
                    result.error = f"Analisi non riuscita: {type(exc).__name__}: {exc}"[:500]
            result.answer = _text(final) if final else ""
            if not result.answer and not result.error:
                result.error = (f"Analisi interrotta dopo {self.settings.max_agent_steps} passi senza una conclusione."
                                if exhausted else "L'agente non ha prodotto una risposta finale.")
            result.table = box.table("risultato")

        result.duration_ms = int((time.monotonic() - started) * 1000)
        log.info("analisi: %d passi, %d grafici, %d ms, errore=%s", result.steps, len(result.charts),
                 result.duration_ms, bool(result.error))
        return result
