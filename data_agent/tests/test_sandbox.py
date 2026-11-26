import multiprocessing as mp
import os
import pickle
import time

import pandas as pd
import pytest

from app import safe_pickle
from app.sandbox import PolicyError, Sandbox, check_code


@pytest.mark.parametrize("code", [
    "import os",
    "import subprocess",
    "from pathlib import Path",
    "open('/etc/passwd').read()",
    "__import__('os')",
    "df.__class__.__subclasses__()",
    "getattr(df, 'to_csv')('x.csv')",
    "df.to_csv('/tmp/x.csv')",
    "pd.read_csv('/etc/passwd')",
    "plt.savefig('/tmp/x.png')",
    "eval('1+1')",
    # nomi importati direttamente: aggirerebbero il controllo sugli attributi
    "from pandas import read_csv",
    "from pandas import read_pickle as rp",
    "from numpy import load",
    "from matplotlib.pyplot import savefig",
    "from pandas import *",
    # metodi speciali (es. __reduce__ per far eseguire codice a chi deserializza)
    "class S(str):\n    def __reduce__(self):\n        return (print, ('x',))",
    "__name__",
    # file, rete, memoria mappata, estensioni C
    "np.memmap('x', mode='w+', shape=3)",
    "np.ctypeslib",
    "df.to_string('/tmp/x.txt')",
    "df.to_string(buf='x.txt')",
    "x = 'https://example.com/?k=1'",
    "p = '/proc/self/environ'",
    "pd.eval('1+1')",
    "fig.canvas.print_png('x.png')",
])
def test_policy_rejects_dangerous_code(code):
    with pytest.raises(PolicyError):
        check_code(code)


@pytest.mark.parametrize("code", [
    "import pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt",
    "df.groupby('formato')['spesa_eur'].sum().sort_values()",
    "pd.to_datetime(df['data']).dt.to_period('M')",
])
def test_policy_allows_normal_analysis(code):
    check_code(code)


@pytest.fixture
def small_frame(tmp_path):
    path = tmp_path / "df.pkl"
    with open(path, "wb") as fh:
        pickle.dump(pd.DataFrame({"formato": ["A", "B", "A"], "spesa": [1.0, 2.0, 3.0]}), fh)
    return path


def test_state_persists_and_last_expression_is_printed(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        assert box.run("totale = df['spesa'].sum()").ok
        out = box.run("totale * 2")
        assert out.ok and out.output.strip() == "12.0"


def test_open_figures_are_saved_as_charts(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        out = box.run("df.groupby('formato')['spesa'].sum().plot.bar()")
        assert out.ok and len(out.charts) == 1
        assert (tmp_path / f"{out.charts[0]}.png").stat().st_size > 1000


def test_timeout_kills_the_process(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=2) as box:
        out = box.run("while True:\n    pass")
        assert not out.ok and "timeout" in out.error
        assert box.run("1 + 1").ok  # dopo il timeout si riparte con un processo nuovo


def _child_environ(conn):
    """Eseguita in un processo "spawn", come la sandbox: legge l'ambiente con cui è nato il processo."""
    with open("/proc/self/environ", "rb") as fh:
        conn.send(fh.read())


@pytest.mark.skipif(not os.path.exists("/proc/self/environ"), reason="solo Linux")
def test_child_processes_do_not_inherit_secrets(monkeypatch):
    from app import config

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-segreto-di-prova")
    monkeypatch.setenv("DATA_AGENT_TOKEN", "token-segreto-di-prova")
    monkeypatch.setattr(config, "get_settings", lambda: None)
    config.scrub_secret_env()
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe()
    proc = ctx.Process(target=_child_environ, args=(child,))
    proc.start()
    environ = parent.recv()
    proc.join(10)
    assert b"sk-segreto-di-prova" not in environ and b"token-segreto-di-prova" not in environ


def test_child_replies_cannot_run_code_in_the_server(tmp_path):
    """Anche se la policy venisse aggirata, il server non deserializza oggetti arbitrari dal figlio."""
    evil = pickle.dumps(_Evil())
    with pytest.raises(safe_pickle.UnsafePickleError):
        safe_pickle.loads(evil)
    assert not (tmp_path / "pwned").exists()


class _Evil:
    def __reduce__(self):
        return (os.system, ("touch pwned",))


def test_safe_pickle_reads_dataframes(small_frame):
    df = pd.read_pickle(small_frame)
    frame = df.assign(data=pd.to_datetime("2026-01-01"), testo=df.columns[0], flag=True)
    frame = frame.astype({"flag": "boolean"})
    assert safe_pickle.loads(pickle.dumps(frame)).equals(frame)


def test_output_and_charts_are_capped(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        out = box.run("for i in range(200000):\n    print('x' * 50)")
        assert out.ok and len(out.output) < 5000 and "troncato" in out.output
        out = box.run("for i in range(10):\n    plt.figure()\n    plt.plot([1, 2])")
        assert out.ok and len(out.charts) == 4
        assert box.run("x = np.ones(10**10)").ok is False  # oltre il limite di memoria: errore, non OOM del server


def test_run_respects_the_remaining_time(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        box.run("1")  # avvio del processo fuori dalla misura
        started = time.monotonic()
        out = box.run("while True:\n    pass", timeout_s=2)
        assert not out.ok and time.monotonic() - started < 10


def test_errors_are_returned_not_raised(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        out = box.run("df['colonna_inesistente']")
        assert not out.ok and "KeyError" in out.error


def test_result_table_drops_meaningless_index(small_frame, tmp_path):
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        box.run("risultato = df.groupby('formato')['spesa'].sum()")
        table = box.table("risultato")
        assert table["columns"] == ["formato", "spesa"]
        box.run("risultato = df.sort_values('spesa', ascending=False)")
        assert box.table("risultato")["columns"] == ["formato", "spesa"]


def test_esecuzioni_parallele_serializzate(tmp_path):
    """Più tool call in parallelo (come fa DeepSeek) non devono far ripartire o chiudere l'interprete."""
    from concurrent.futures import ThreadPoolExecutor

    with Sandbox({}, tmp_path, exec_timeout_s=10) as box:
        box.run("x = 0")
        with ThreadPoolExecutor(4) as pool:
            results = list(pool.map(lambda i: box.run(f"x = x + 1\nprint({i})"), range(8)))
        assert all(r.ok for r in results), [r.error for r in results]
        assert box.run("print(x)").output.strip() == "8"
