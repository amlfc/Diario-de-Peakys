from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.cache import TTLCache
from app.models import UserScope
from app.routers.fx import router
from tests.conftest import FakeMarketClient, sample_liquidity, sample_transactions


class FakeRepo:
    def get_transactions(self, scope: UserScope):
        return sample_transactions(), ["Core"]

    def get_liquidity(self, scope: UserScope):
        return sample_liquidity()


def test_api_returns_payloads_without_breaking_on_missing_tickers():
    app = FastAPI()
    app.state.response_cache = TTLCache(60)
    app.state.market_client = FakeMarketClient()
    app.state.portfolio_repository = FakeRepo()
    app.include_router(router)

    client = TestClient(app)

    overview = client.get("/api/fx/overview")
    exposure = client.get("/api/fx/exposure", params={"user_id": 1, "role": "user", "username": "alejandro", "portfolio": "ALL"})
    stress = client.post("/api/fx/stress_test", json={"user_id": 1, "role": "user", "username": "alejandro", "portfolio": "ALL", "scenario": "usd_rally"})

    assert overview.status_code == 200
    assert exposure.status_code == 200
    assert stress.status_code == 200
    assert "ETH-EUR" in overview.json()["excluded_tickers"]
    assert exposure.json()["currency_breakdown"]
    assert stress.json()["portfolio_totals"]["current_value_eur"] > 0
