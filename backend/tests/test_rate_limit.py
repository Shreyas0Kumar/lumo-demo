from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.rate_limit import DailyIpLimiter, limiter

client = TestClient(app)


def test_daily_ip_limiter_unit():
    lim = DailyIpLimiter()
    assert lim.consume("1.2.3.4", 2) == (True, 1)
    assert lim.consume("1.2.3.4", 2) == (True, 0)
    assert lim.consume("1.2.3.4", 2) == (False, 0)
    # A different IP has its own bucket.
    assert lim.consume("5.6.7.8", 2) == (True, 1)
    # limit <= 0 disables the cap entirely.
    assert lim.consume("9.9.9.9", 0) == (True, -1)


def test_quota_endpoint_caps_per_ip():
    # Reset shared limiter state for a deterministic run.
    limiter._counts.clear()
    limiter._day = None

    cap = settings.SESSION_CAP_PER_IP_PER_DAY
    if cap <= 0:
        return  # cap disabled in this environment

    results = [client.post("/session/quota").json() for _ in range(cap + 1)]
    assert all(r["allowed"] for r in results[:cap])
    assert results[0]["limit"] == cap
    assert results[-1]["allowed"] is False
    assert results[-1]["remaining"] == 0
