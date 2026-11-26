"""Esecuzione isolata del codice Python generato dall'LLM.

Difesa a più livelli, proporzionata a un servizio interno:
1. Policy statica (AST): import solo da una lista chiusa; niente funzioni, attributi o nomi importati che
   leggono/scrivono file o rete, aprono processi o permettono introspezione (`__class__`, `getattr`,
   metodi speciali come `__reduce__`); niente percorsi di sistema o URL nelle stringhe.
2. Processo figlio dedicato, avviato con "spawn": non eredita la memoria del server. Il server toglie i
   segreti dal proprio ambiente all'avvio (`config.scrub_secret_env`), quindi il figlio non li riceve
   nemmeno in `/proc/self/environ`; il figlio ripulisce comunque le variabili sensibili.
3. Il figlio risponde solo in JSON; i DataFrame restituiti alla pulizia passano da un unpickler ristretto
   (`safe_pickle`): il codice generato non può far eseguire nulla al server.
4. Limiti per ogni esecuzione: tempo (il processo viene terminato), CPU, memoria, dimensione dei file,
   output e numero di grafici.
5. Nel deployment con Docker il container gira come utente non-root, senza capability, con filesystem di
   sola lettura tranne i volumi dei dati, e la porta non è esposta all'esterno.

La policy statica è difesa in profondità, non un confine di sicurezza: il confine è il processo
(e il container). Per questo i livelli sono indipendenti. Limite noto: il figlio condivide utente e rete
del container (servono per OpenRouter); un isolamento completo richiederebbe un container separato senza
rete per l'esecuzione del codice.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import multiprocessing as mp
import os
import pickle
import re
import threading
import uuid
from dataclasses import dataclass, field
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

from . import safe_pickle

MAX_OUTPUT_CHARS = 4000
MAX_CHARTS = 4  # grafici salvati per esecuzione; gli altri vengono chiusi
MEMORY_LIMIT_BYTES = 3 * 1024**3  # spazio di indirizzamento del figlio (pandas, numpy e matplotlib inclusi)
FILE_SIZE_LIMIT_BYTES = 20 * 1024**2  # un grafico PNG pesa ~100 KB

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
    "fromregex", "memmap", "open_memmap", "DataSource", "HDFStore", "ExcelWriter", "ExcelFile", "imsave",
    "imread", "load_dataset", "get_data_home",
    # moduli e funzioni di sistema raggiungibili come attributi
    "io", "os", "sys", "subprocess", "builtins", "system", "popen", "remove", "unlink", "rmdir",
    "lib", "ctypes", "ctypeslib", "f2py", "eval",
}
FORBIDDEN_ATTRIBUTE_PREFIXES = ("__", "read_", "print_")
# metodi che scrivono su file se ricevono un percorso (`buf`): ammessi solo senza argomenti posizionali
WRITES_WITH_BUF = {"to_string", "to_markdown"}
# percorsi di sistema e URL nelle stringhe: il codice lavora solo sui dati già caricati
FORBIDDEN_STRINGS = re.compile(r"(?i)^\s*(https?|ftp|file)://|/(proc|etc|sys|dev|root|home|app|tmp)(/|$)|\.env\b|__")
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
            if node.module not in ALLOWED_IMPORTS or node.level:
                raise PolicyError(f"Import non consentito: {node.module}. Moduli ammessi: {sorted(ALLOWED_IMPORTS)}")
            for alias in node.names:  # `from pandas import read_csv` aggirerebbe il controllo sugli attributi
                if alias.name == "*" or _forbidden_name(alias.name):
                    raise PolicyError(f"Import non consentito: `{alias.name}` da {node.module}.")
        elif isinstance(node, ast.Name) and (node.id in FORBIDDEN_NAMES or node.id.startswith("__")):
            raise PolicyError(f"Uso non consentito di `{node.id}`.")
        elif isinstance(node, ast.Attribute) and _forbidden_name(node.attr):
            raise PolicyError(
                f"Attributo non consentito: `.{node.attr}`. Non leggere né scrivere file: "
                "i dati sono già caricati e i grafici aperti vengono salvati automaticamente."
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name.startswith("__"):
            raise PolicyError(f"Metodi speciali non consentiti: `{node.name}`.")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in WRITES_WITH_BUF:
            if node.args or any(k.arg in ("buf", None) for k in node.keywords):
                raise PolicyError(f"`.{node.func.attr}()` non può scrivere su file: usalo senza percorso.")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and FORBIDDEN_STRINGS.search(node.value):
            raise PolicyError("Percorsi di sistema, URL e nomi speciali non sono consentiti: lavora sui dati già caricati.")
    return tree


def _forbidden_name(name: str) -> bool:
    return name in FORBIDDEN_NAMES or name in FORBIDDEN_ATTRIBUTES or name.startswith(FORBIDDEN_ATTRIBUTE_PREFIXES)


# --- Processo figlio --------------------------------------------------------------------

def _configure_matplotlib() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from cycler import cycler

    # Palette del brand (oltremare, vermiglio, ocra, oliva), in ordine fisso: oltremare e oliva leggermente
    # schiariti/saturati per restare distinguibili anche con deficit nella visione dei colori. Il quinto colore,
    # neutro, è per "Altro". L'ocra ha poco contrasto sul fondo: la tabella dei dati è sempre accanto al grafico.
    palette = ["#3651BC", "#E4472E", "#E3A72F", "#6F8C2B", "#8A857A"]
    plt.rcParams.update({
        "figure.figsize": (9, 5), "figure.facecolor": "#FDFCF8", "axes.facecolor": "#FDFCF8",
        "axes.prop_cycle": cycler(color=palette), "axes.edgecolor": "#C9C3B4", "axes.linewidth": 0.8,
        "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.axisbelow": True,
        "grid.color": "#E8E3D6", "grid.linewidth": 0.8, "axes.titlesize": 13, "axes.titleweight": "bold",
        "axes.titlelocation": "left", "axes.labelcolor": "#4A4740", "axes.titlecolor": "#1A1A1A",
        "xtick.color": "#4A4740", "ytick.color": "#4A4740", "text.color": "#1A1A1A",
        "lines.linewidth": 2.0, "lines.markersize": 6, "legend.frameon": False, "font.size": 10,
    })


def _scrub_environment() -> None:
    for name in list(os.environ):
        if any(marker in name.upper() for marker in SENSITIVE_ENV_MARKERS):
            del os.environ[name]
    os.environ["OPENBLAS_NUM_THREADS"] = "1"


def _limit_resources(cpu_seconds: int) -> None:
    """CPU, memoria e dimensione dei file del figlio: un ciclo infinito o un array enorme non toccano il server."""
    try:
        import resource  # solo Unix

        for limit, value in ((resource.RLIMIT_CPU, cpu_seconds), (resource.RLIMIT_AS, MEMORY_LIMIT_BYTES),
                             (resource.RLIMIT_FSIZE, FILE_SIZE_LIMIT_BYTES)):
            with contextlib.suppress(ValueError, OSError):
                resource.setrlimit(limit, (value, value))
    except ImportError:
        pass


class _CappedOutput(io.StringIO):
    """stdout con un tetto: oltre il limite il testo viene scartato invece di occupare memoria."""

    def __init__(self, limit: int):
        super().__init__()
        self._room = limit
        self.truncated = False

    def write(self, text: str) -> int:
        if self._room > 0:
            super().write(text[: self._room])
            self._room -= len(text)
        if self._room < 0:
            self.truncated = True
        return len(text)


def _run_cell(tree: ast.Module, namespace: dict) -> str:
    """Esegue il codice come una cella di notebook: se l'ultima istruzione è un'espressione ne stampa il valore."""
    buffer = _CappedOutput(MAX_OUTPUT_CHARS)
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body.pop().value)
    with contextlib.redirect_stdout(buffer):
        exec(compile(tree, "<agente>", "exec"), namespace)
        if last_expr is not None:
            value = eval(compile(last_expr, "<agente>", "eval"), namespace)
            if value is not None:
                print(_display(value))
    output = buffer.getvalue()
    if buffer.truncated:
        output += f"\n... [output troncato a {MAX_OUTPUT_CHARS} caratteri]"
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
    for num in plt.get_fignums()[:MAX_CHARTS]:
        fig = plt.figure(num)
        chart_id = uuid.uuid4().hex
        fig.savefig(charts_dir / f"{chart_id}.png", dpi=144, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        ids.append(chart_id)
    plt.close("all")  # oltre MAX_CHARTS: scartati
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
    if v is None or type(v) in (str, int, float, bool):  # tipi esatti: niente sottoclassi definite dal codice
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "item"):
        return v.item()
    return str(v)


def _send(conn: Connection, reply: dict, frame_bytes: bytes | None = None) -> None:
    """Risposte del figlio solo in JSON (il server non deserializza mai oggetti Python arbitrari dal figlio)."""
    conn.send_bytes(json.dumps({**reply, "has_frame": frame_bytes is not None}, default=str).encode())
    if frame_bytes is not None:
        conn.send_bytes(frame_bytes)


def _worker_main(conn: Connection, frames: dict[str, str], charts_dir: str, cpu_limit_s: int) -> None:
    _scrub_environment()
    _configure_matplotlib()
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    import seaborn as sns

    namespace: dict[str, Any] = {"pd": pd, "np": np, "plt": plt, "sns": sns}
    for name, path in frames.items():
        namespace[name] = safe_pickle.load_path(path)
    _limit_resources(cpu_limit_s)  # dopo gli import e il caricamento dei dati
    charts = Path(charts_dir)
    _send(conn, {"ok": True, "ready": True})
    while True:
        try:
            msg = conn.recv()
        except (EOFError, OSError):  # il server ha chiuso il canale: uscita pulita
            break
        op = msg.get("op")
        if op == "close":
            break
        try:
            if op == "exec":
                tree = check_code(msg["code"])  # ricontrollo anche nel figlio
                output = _run_cell(tree, namespace)
                _send(conn, {"ok": True, "output": output, "charts": _save_open_figures(charts)})
            elif op == "table":
                _send(conn, {"ok": True, "table": _to_table(namespace.get(msg["name"]))})
            elif op == "get_frame":
                value = namespace.get(msg["name"])
                frame = pickle.dumps(pd.DataFrame(value)) if isinstance(value, pd.DataFrame) else None
                _send(conn, {"ok": True, "extra": _json_safe_tree(namespace.get(msg.get("extra_name", "")))}, frame)
            else:
                _send(conn, {"ok": False, "error": f"operazione sconosciuta: {op}"})
        except Exception as exc:  # l'errore torna all'agente, che può correggersi
            plt.close("all")
            _send(conn, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})


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

    def __init__(self, frames: dict[str, Path], charts_dir: Path, exec_timeout_s: float, cpu_limit_s: int = 120,
                 start_timeout_s: float = 60, reply_timeout_s: float = 30):
        self._frames = {k: str(v) for k, v in frames.items()}
        self._charts_dir = charts_dir
        self._timeout = exec_timeout_s
        self._cpu_limit = cpu_limit_s
        self._start_timeout = start_timeout_s  # import di pandas/matplotlib e caricamento dei dati
        self._reply_timeout = reply_timeout_s  # operazioni di servizio (tabella, DataFrame), non codice generato
        self._ctx = mp.get_context("spawn")
        self._proc: mp.process.BaseProcess | None = None
        self._conn: Connection | None = None
        # Alcuni modelli chiedono più esecuzioni in parallelo (parallel tool calls): l'interprete è uno solo e
        # con stato, come un notebook, quindi le richieste vengono eseguite una alla volta, nell'ordine.
        self._lock = threading.RLock()

    def __enter__(self) -> Sandbox:
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
        if not parent.poll(self._start_timeout) or not self._receive().get("ready"):
            self.close()
            raise RuntimeError("Il processo di esecuzione non si è avviato.")

    def _receive(self) -> dict:
        """Legge una risposta JSON del figlio; un DataFrame allegato passa dall'unpickler ristretto."""
        assert self._conn is not None
        reply = json.loads(self._conn.recv_bytes())
        if not isinstance(reply, dict):
            raise ValueError("risposta non valida dal processo di esecuzione")
        if reply.pop("has_frame", False):
            reply["frame"] = safe_pickle.loads(self._conn.recv_bytes())
        return reply

    def _request(self, msg: dict, timeout: float) -> dict:
        with self._lock:
            return self._request_locked(msg, timeout)

    def _request_locked(self, msg: dict, timeout: float) -> dict:
        if self._proc is None or not self._proc.is_alive():
            self._start()
        assert self._conn is not None
        self._conn.send(msg)
        if not self._conn.poll(timeout):
            self.close()  # il codice è bloccato o troppo lento: si termina il processo
            return {"ok": False, "error": f"Esecuzione interrotta dopo {timeout:.0f} s (timeout). "
                                          "Lo stato delle variabili è stato azzerato: semplifica il calcolo."}
        try:
            return self._receive()
        except EOFError:
            self.close()
            return {"ok": False, "error": "Il processo di esecuzione è terminato inaspettatamente (limite di risorse)."}
        except (ValueError, safe_pickle.UnsafePickleError) as exc:
            self.close()
            return {"ok": False, "error": f"Risposta rifiutata dal server: {exc}"}

    def run(self, code: str, timeout_s: float | None = None) -> ExecResult:
        """`timeout_s`: tempo rimasto al chiamante, se inferiore al limite per esecuzione."""
        try:
            check_code(code)
        except PolicyError as exc:
            return ExecResult(ok=False, error=f"Codice rifiutato dalla policy di sicurezza: {exc}")
        timeout = self._timeout if timeout_s is None else max(1.0, min(self._timeout, timeout_s))
        reply = self._request({"op": "exec", "code": code}, timeout)
        if reply.get("ok"):
            return ExecResult(ok=True, output=reply.get("output", ""), charts=reply.get("charts", []))
        return ExecResult(ok=False, error=reply.get("error", "errore sconosciuto"))

    def table(self, name: str) -> dict | None:
        with self._lock:
            if self._proc is None or not self._proc.is_alive():
                return None
            reply = self._request_locked({"op": "table", "name": name}, self._reply_timeout)
        return reply.get("table") if reply.get("ok") else None

    def get_frame(self, name: str, extra_name: str = "") -> tuple[Any, Any]:
        reply = self._request({"op": "get_frame", "name": name, "extra_name": extra_name}, self._reply_timeout)
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error"))
        return reply.get("frame"), reply.get("extra")

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
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
