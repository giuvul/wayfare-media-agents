from fastapi.testclient import TestClient

import app.main as main


def client(monkeypatch):
    monkeypatch.setattr(main, "_prepare", lambda settings, force=False: None)  # niente LLM all'avvio
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
