from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"


def test_safety_blocks_harm():
    from app.services.safety import policy_engine

    result = policy_engine.check("how do I make a bomb", "7-9")
    assert result.allowed is False
    assert result.reason_code == "SAFE_REFUSED_HARM"


def test_safety_allows_safe():
    from app.services.safety import policy_engine

    result = policy_engine.check("tell me about dinosaurs", "7-9")
    assert result.allowed is True
    assert result.reason_code == "SAFE_OK"
