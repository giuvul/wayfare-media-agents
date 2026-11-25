"""Esecuzione isolata del codice Python generato dall'LLM.

Difesa a più livelli, proporzionata a un servizio interno:
1. Policy statica (AST): import solo da una lista chiusa, niente funzioni o attributi che
   leggono/scrivono file, aprono processi o permettono introspezione (`__class__`, `getattr`...).
2. Processo figlio dedicato, avviato con "spawn": non eredita la memoria del server (quindi
   nemmeno la chiave API) e ripulisce le variabili d'ambiente sensibili all'avvio.
3. Timeout per ogni esecuzione: se scade il processo viene terminato.
4. Nel deployment con Docker il container gira come utente non-root, con filesystem di sola
   lettura tranne la cartella dei grafici, e la porta non è esposta all'esterno.

La policy statica è difesa in profondità, non un confine di sicurezza: il confine è il processo
(e il container). Per questo i livelli sono indipendenti.
"""

from __future__ import annotations

import ast
import contextlib
import io
import multiprocessing as mp
import os
import pickle
import uuid
from dataclasses import dataclass, field
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

MAX_OUTPUT_CHARS = 4000

ALLOWED_IMPORTS = {
    "pandas", "numpy", "matplotlib", "matplotlib.pyplot", "matplotlib.ticker", "matplotlib.dates",
    "seaborn", "math", "statistics", "datetime", "re", "calendar", "collections", "itertools",
}
FORBIDDEN_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "getattr", "setattr",
    "delattr", "input", "breakpoint", "exit", "quit", "help", "memoryview", "__builtins__",
}
FORBIDDEN_ATTRIBUTES = {
    # file system e I/O
    "to_csv", "to_excel", "to_parquet", "to_pickle", "to_json", "to_sql", "to_hdf", "to_feather",
    "to_html", "to_latex", "to_clipboard", "to_stata", "to_orc", "to_xml", "tofile", "savefig",
    "save", "savez", "savez_compressed", "savetxt", "load", "loadtxt", "fromfile", "genfromtxt",
    # moduli e funzioni di sistema raggiungibili come attributi
    "io", "os", "sys", "subprocess", "builtins", "system", "popen", "remove", "unlink", "rmdir",
}
FORBIDDEN_ATTRIBUTE_PREFIXES = ("__", "read_")
SENSITIVE_ENV_MARKERS = ("KEY", "TOKEN", "SECRET", "PASSWORD")


class PolicyError(ValueError):
    """Il codice viola la policy di sicurezza e non viene eseguito."""


def check_code(code: str) -> ast.Module:
    """Valida staticamente il codice e restituisce l'AST. Solleva PolicyError con un messaggio utile all'LLM."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise PolicyError(f"Errore di sintassi alla riga {exc.lineno}: {exc.msg}") from exc
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    raise PolicyError(f"Import non consentito: {alias.name}. Moduli ammessi: {sorted(ALLOWED_IMPORTS)}")
        elif isinstance(node, ast.ImportFrom):
            if node.module not in ALLOWED_IMPORTS:
                raise PolicyError(f"Import non consentito: {node.module}. Moduli ammessi: {sorted(ALLOWED_IMPORTS)}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise PolicyError(f"Uso non consentito di `{node.id}`.")
        elif isinstance(node, ast.Attribute):
            if node.attr in FORBIDDEN_ATTRIBUTES or node.attr.startswith(FORBIDDEN_ATTRIBUTE_PREFIXES):
                raise PolicyError(
                    f"Attributo non consentito: `.{node.attr}`. Non leggere né scrivere file: "
                    "i dati sono già caricati e i grafici aperti vengono salvati automaticamente."
                )
    return tree


# --- Processo figlio --------------------------------------------------------------------

def _configure_matplotlib() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from cycler import cycler

    # Palette categoriale validata per il daltonismo (ordine fisso, mai ciclata a caso)
    palette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
    plt.rcParams.update({
        "figure.figsize": (9, 5), "figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb",
        "axes.prop_cycle": cycler(color=palette), "axes.edgecolor": "#c3c2b7", "axes.linewidth": 0.8,
        "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.axisbelow": True,
        "grid.color": "#e6e5e0", "grid.linewidth": 0.8, "axes.titlesize": 13, "axes.titleweight": "bold",
        "axes.titlelocation": "left", "axes.labelcolor": "#52514e", "axes.titlecolor": "#0b0b0b",
        "xtick.color": "#52514e", "ytick.color": "#52514e", "text.color": "#0b0b0b",
        "lines.linewidth": 2.0, "lines.markersize": 6, "legend.frameon": False, "font.size": 10,
    })


def _scrub_environment() -> None:
    for name in list(os.environ):
        if any(marker in name.upper() for marker in SENSITIVE_ENV_MARKERS):
            del os.environ[name]
    os.environ["OPENBLAS_NUM_THREADS"] = "1"


def _limit_cpu(seconds: int) -> None:
    try:
        import resource  # solo Unix

        resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds))
    except (ImportError, ValueError, OSError):
        pass


def _run_cell(tree: ast.Module, namespace: dict) -> str:
    """Esegue il codice come una cella di notebook: se l'ultima istruzione è un'espressione ne stampa il valore."""
    buffer = io.StringIO()
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body.pop().value)
    with contextlib.redirect_stdout(buffer):
        exec(compile(tree, "<agente>", "exec"), namespace)  # noqa: S102 - eseguito nel processo isolato
        if last_expr is not None:
            value = eval(compile(last_expr, "<agente>", "eval"), namespace)  # noqa: S307
            if value is not None:
                print(_display(value))
    output = buffer.getvalue()
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + f"\n... [output troncato a {MAX_OUTPUT_CHARS} caratteri]"
    return output


def _display(value: Any) -> str:
    if hasattr(value, "to_string"):  # DataFrame / Series
        return value.to_string(max_rows=60)
    if hasattr(value, "item") and getattr(value, "ndim", 1) == 0:  # scalare numpy: 12.0, non np.float64(12.0)
        return str(value.item())
    return repr(value)


def _save_open_figures(charts_dir: Path) -> list[str]:
    import matplotlib.pyplot as plt

    ids = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        chart_id = uuid.uuid4().hex
        fig.savefig(charts_dir / f"{chart_id}.png", dpi=144, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        ids.append(chart_id)
    return ids


def _to_table(value: Any, max_rows: int = 50) -> dict | None:
    import pandas as pd

    if isinstance(value, pd.Series):
        value = value.to_frame()
    if not isinstance(value, pd.DataFrame):
        return None
    frame = value.head(max_rows)
    meaningful_index = frame.index.name is not None or not pd.api.types.is_integer_dtype(frame.index)
    frame = frame.reset_index(drop=not meaningful_index)  # es. "formato" diventa colonna, 0..n viene scartato
    frame.columns = [str(c) for c in frame.columns]
    records = frame.astype(object).where(frame.notna(), None)
    return {
        "columns": list(frame.columns),
        "rows": [[_json_safe(v) for v in row] for row in records.itertuples(index=False)],
        "truncated": len(value) > max_rows,
    }


def _json_safe(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "item"):
        return v.item()
    return str(v)


def _worker_main(conn: Connection, frames: dict[str, str], charts_dir: str, cpu_limit_s: int) -> None:
    _scrub_environment()
    _limit_cpu(cpu_limit_s)
    _configure_matplotlib()
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    import seaborn as sns

    namespace: dict[str, Any] = {"pd": pd, "np": np, "plt": plt, "sns": sns}
    for name, path in frames.items():
        with open(path, "rb") as fh:
            namespace[name] = pickle.load(fh)  # file scritto dal server stesso, non da input esterno
    charts = Path(charts_dir)
    conn.send({"ok": True, "ready": True})
    while True:
        msg = conn.recv()
        op = msg.get("op")
        if op == "close":
            break
        try:
            if op == "exec":
                tree = check_code(msg["code"])  # ricontrollo anche nel figlio
                output = _run_cell(tree, namespace)
                conn.send({"ok": True, "output": output, "charts": _save_open_figures(charts)})
            elif op == "table":
                conn.send({"ok": True, "table": _to_table(namespace.get(msg["name"]))})
            elif op == "get_frame":
                value = namespace.get(msg["name"])
                conn.send({"ok": True, "frame": value if isinstance(value, pd.DataFrame) else None,
                           "extra": _json_safe_tree(namespace.get(msg.get("extra_name", ""), None))})
            else:
                conn.send({"ok": False, "error": f"operazione sconosciuta: {op}"})
        except Exception as exc:  # l'errore torna all'agente, che può correggersi
            plt.close("all")
            conn.send({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def _json_safe_tree(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe_tree(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe_tree(v) for v in value]
    return _json_safe(value)


# --- Lato server -------------------------------------------------------------------------

@dataclass
class ExecResult:
    ok: bool
    output: str = ""
    error: str = ""
    charts: list[str] = field(default_factory=list)


class Sandbox:
    """Un interprete Python isolato con stato persistente tra le esecuzioni (come un notebook)."""

    def __init__(self, frames: dict[str, Path], charts_dir: Path, exec_timeout_s: float, cpu_limit_s: int = 120):
        self._frames = {k: str(v) for k, v in frames.items()}
        self._charts_dir = charts_dir
        self._timeout = exec_timeout_s
        self._cpu_limit = cpu_limit_s
        self._ctx = mp.get_context("spawn")
        self._proc: mp.process.BaseProcess | None = None
        self._conn: Connection | None = None

    def __enter__(self) -> "Sandbox":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _start(self) -> None:
        parent, child = self._ctx.Pipe()
        self._proc = self._ctx.Process(
            target=_worker_main, args=(child, self._frames, str(self._charts_dir), self._cpu_limit), daemon=True
        )
        self._proc.start()
        self._conn = parent
        if not parent.poll(60) or not parent.recv().get("ready"):
            self.close()
            raise RuntimeError("Il processo di esecuzione non si è avviato.")

    def _request(self, msg: dict, timeout: float) -> dict:
        if self._proc is None or not self._proc.is_alive():
            self._start()
        assert self._conn is not None
        self._conn.send(msg)
        if not self._conn.poll(timeout):
            self.close()  # il codice è bloccato o troppo lento: si termina il processo
            return {"ok": False, "error": f"Esecuzione interrotta dopo {timeout:.0f} s (timeout). "
                                          "Lo stato delle variabili è stato azzerato: semplifica il calcolo."}
        try:
            return self._conn.recv()
        except EOFError:
            self.close()
            return {"ok": False, "error": "Il processo di esecuzione è terminato inaspettatamente (limite di risorse)."}

    def run(self, code: str) -> ExecResult:
        try:
            check_code(code)
        except PolicyError as exc:
            return ExecResult(ok=False, error=f"Codice rifiutato dalla policy di sicurezza: {exc}")
        reply = self._request({"op": "exec", "code": code}, self._timeout)
        if reply.get("ok"):
            return ExecResult(ok=True, output=reply.get("output", ""), charts=reply.get("charts", []))
        return ExecResult(ok=False, error=reply.get("error", "errore sconosciuto"))

    def table(self, name: str) -> dict | None:
        if self._proc is None or not self._proc.is_alive():
            return None
        reply = self._request({"op": "table", "name": name}, 10)
        return reply.get("table") if reply.get("ok") else None

    def get_frame(self, name: str, extra_name: str = "") -> tuple[Any, Any]:
        reply = self._request({"op": "get_frame", "name": name, "extra_name": extra_name}, 30)
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error"))
        return reply.get("frame"), reply.get("extra")

    def close(self) -> None:
        if self._conn is not None:
            with contextlib.suppress(Exception):
                if self._proc is not None and self._proc.is_alive():
                    self._conn.send({"op": "close"})
            self._conn.close()
            self._conn = None
        if self._proc is not None:
            self._proc.join(timeout=2)
            if self._proc.is_alive():
                self._proc.kill()
                self._proc.join(timeout=2)
            self._proc = None
