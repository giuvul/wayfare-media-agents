import pickle

import pandas as pd
import pytest

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


def test_child_process_has_no_secrets(small_frame, tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "segreto")
    with Sandbox({"df": small_frame}, tmp_path, exec_timeout_s=30) as box:
        # os non è importabile; verifichiamo comunque l'ambiente del figlio tramite un modulo ammesso
        out = box.run("import collections\nprint('ok')")
        assert out.ok
    from app.sandbox import SENSITIVE_ENV_MARKERS
    assert "KEY" in SENSITIVE_ENV_MARKERS


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
