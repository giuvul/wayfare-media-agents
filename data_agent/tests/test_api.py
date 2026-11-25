from fastapi.testclient import TestClient

import app.main as main


def client(monkeypatch):
    monkeypatch.setattr(main, "_prepare", lambda settings, force=False, llm=None: None)  # niente LLM all'avvio
    return TestClient(main.app)


def test_health_is_public(monkeypatch):
    with client(monkeypatch) as c:
        assert c.get("/health").status_code == 200


def test_analyze_requires_token(monkeypatch):
    with client(monkeypatch) as c:
        assert c.post("/analyze", json={"task": "ciao a tutti"}).status_code == 401
        r = c.post("/analyze", json={"task": "ciao a tutti"}, headers={"X-Internal-Token": "sbagliato"})
        assert r.status_code == 401


def test_analyze_unavailable_until_data_is_ready(monkeypatch):
    token = main.get_settings().data_agent_token.get_secret_value()
    with client(monkeypatch) as c:
        r = c.post("/analyze", json={"task": "CPM per formato"}, headers={"X-Internal-Token": token})
        assert r.status_code == 503


def test_chart_id_rejects_path_traversal(monkeypatch):
    token = main.get_settings().data_agent_token.get_secret_value()
    with client(monkeypatch) as c:
        for bad in ("..%2F..%2Fetc%2Fpasswd", "abc", "../cache/df"):
            r = c.get(f"/charts/{bad}", headers={"X-Internal-Token": token})
            assert r.status_code in (400, 404)


def _fake_csv(tmp_path):
    path = tmp_path / "campagne.csv"
    path.write_text("id_riga,aeroporto,cpm_contrattuale\nR1,FCO,\"16,20 €\"\nR2,mxp ,9.0\nR2,mxp ,9.0\n", encoding="utf-8")
    return path


def test_dataset_page_and_cell_update(monkeypatch, tmp_path):
    token = main.get_settings().data_agent_token.get_secret_value()
    csv_path = _fake_csv(tmp_path)
    monkeypatch.setattr(main.get_settings(), "data_csv_path", csv_path)
    h = {"X-Internal-Token": token}
    with client(monkeypatch) as c:
        page = c.get("/dataset", params={"q": "mxp"}, headers=h).json()
        assert page["total"] == 2 and page["columns"][0] == "id_riga"
        r = c.patch("/dataset/rows/R2", json={"column": "aeroporto", "value": "MXP"}, headers=h)
        assert r.status_code == 200 and r.json()["rows_updated"] == 2
        assert c.patch("/dataset/rows/R1", json={"column": "id_riga", "value": "X"}, headers=h).status_code == 400
        assert c.patch("/dataset/rows/R9", json={"column": "aeroporto", "value": "X"}, headers=h).status_code == 404
        assert c.patch("/dataset/rows/..%2Fx", json={"column": "aeroporto", "value": "X"}, headers=h).status_code in (400, 404)
    text = csv_path.read_text(encoding="utf-8")
    assert '"16,20 €"' in text and "R2,MXP,9.0" in text  # le altre celle (anche anomale) restano identiche


def test_dataset_requires_token(monkeypatch):
    with client(monkeypatch) as c:
        assert c.get("/dataset").status_code == 401
        assert c.put("/dictionary", json={"content": "x"}).status_code == 401


def test_llm_override_rejects_bad_model_name(monkeypatch):
    token = main.get_settings().data_agent_token.get_secret_value()
    with client(monkeypatch) as c:
        r = c.post("/analyze", json={"task": "CPM per formato", "model": "x; rm -rf /"}, headers={"X-Internal-Token": token})
        assert r.status_code == 422


def test_analyze_rifiuta_un_timeout_fuori_intervallo(monkeypatch):
    """La scadenza propagata dal back end è validata: niente analisi da 1 secondo o da ore."""
    token = main.get_settings().data_agent_token.get_secret_value()
    with client(monkeypatch) as c:
        for bad in (0, 1, 10_000):
            r = c.post("/analyze", json={"task": "conta le campagne", "timeout_s": bad}, headers={"X-Internal-Token": token})
            assert r.status_code == 422
